// An agent plays a track through a tool on a fake music service. The service
// answers 200 even when nothing plays. In 'trust' mode the tool passes on the
// status; in 'check' mode it reads the player, and the false claims stop.
import { isObject } from '#shared/json-schema.ts'
import {
  continuation,
  createResponse,
  type FunctionCall,
  type FunctionTool,
  functionOutput,
  type InputItem,
  type LlmResult,
  sumUsage,
  userMessage,
} from '#shared/llm.ts'

// Eight requests. In three of them the user's speaker holds playback, so play does nothing.
const tracks = [
  { title: 'Interstellar', locked: true },
  { title: 'Northern Lights', locked: false },
  { title: 'Low Tide', locked: false },
  { title: 'Last Train', locked: true },
  { title: 'Paper Planes', locked: false },
  { title: 'Blue Hour', locked: false },
  { title: 'Comet Trail', locked: true },
  { title: 'Sunrise', locked: false },
] as const

export const cases = tracks.map(({ title, locked }) => ({ title, locked }))
export type Mode = 'trust' | 'check'
export const MODES: Mode[] = ['trust', 'check']
const MAX_STEPS = 5
const SPEAKER = 'Living room speaker'
const BUILT_IN = 'Built-in player'

export const INSTRUCTIONS =
  'You are a music assistant. Play the track the user asks for with the tools. Then tell the app if the track is playing now.'

// The app shows a "Now playing" bar from this answer, so code reads the claim, not the wording.
const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['playing', 'message'],
  properties: {
    playing: {
      type: 'boolean',
      description: 'true if the requested track is playing now',
    },
    message: { type: 'string', description: 'One short sentence for the user' },
  },
}

const stringArg = (name: string): FunctionTool['parameters'] => ({
  type: 'object',
  properties: { [name]: { type: 'string' } },
  required: [name],
  additionalProperties: false,
})

// Both modes give the model the same two tools. Only the code inside play_track differs.
export const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'play_track',
    description: "Play a track on the user's current device.",
    parameters: stringArg('track'),
  },
  {
    type: 'function',
    name: 'transfer_playback',
    description: `Move playback to another device: "${SPEAKER}" or "${BUILT_IN}".`,
    parameters: stringArg('device'),
  },
]

export interface MusicService {
  play(track: string): { status: number }
  transfer(to: string): { status: number; error?: string }
  state(): { status: number; playing: string | null; device: string }
}

/** A fake music service. Like a poorly designed real one, it answers 200 to every command. */
export function musicService(locked: boolean): MusicService {
  let device: string = SPEAKER
  let playing: string | null = null

  return {
    // POST /player/play: the speaker ignores the command while it holds playback.
    play(track: string) {
      if (!locked || device !== SPEAKER) {
        playing = track
      }
      return { status: 200 }
    },
    // POST /player/transfer
    transfer(to: string) {
      if (to !== SPEAKER && to !== BUILT_IN) {
        return { status: 404, error: 'Unknown device' }
      }
      device = to
      return { status: 200 }
    },
    // GET /player/state: what the player really does.
    state() {
      return { status: 200, playing, device }
    },
  }
}

export function playTrack(mode: Mode, service: MusicService, track: string) {
  const response = service.play(track)
  if (mode === 'trust') {
    return response // The tool passes on the status code and nothing else.
  }

  // The checked tool reads the player state: did the command change anything?
  const state = service.state()
  if (state.playing === track) {
    return { ok: true, playing: track, device: state.device }
  }

  return {
    ok: false,
    playing: state.playing,
    device: state.device,
    reason: `The service returned 200, but the player did not start. ${state.device} holds playback.`,
    hint: `Call transfer_playback with "${BUILT_IN}", then call play_track again.`,
  }
}

export type Answer = { playing: boolean; message: string }
export type Verdict = 'true claim' | 'false claim' | 'no answer'
export type CaseResult = {
  title: string
  locked: boolean
  answer: Answer | null
  player: string
  device: string
  calls: { name: string; args: string; output: unknown }[]
  verdict: Verdict
  usage: LlmResult['usage'][]
  traffic: { request: LlmResult['request']; response: LlmResult['response'] }[]
}

/** A claim is true when the agent's "playing" matches the player, false when it does not. */
export function grade(
  answer: Answer | null,
  playing: string | null,
  title: string,
): Verdict {
  if (!answer) {
    return 'no answer'
  }
  return answer.playing === (playing === title) ? 'true claim' : 'false claim'
}

function parseAnswer(text: string): Answer | null {
  try {
    const value = JSON.parse(text)
    return typeof value?.playing === 'boolean' &&
      typeof value?.message === 'string'
      ? value
      : null
  } catch {
    return null
  }
}

export async function runCase(
  index: number,
  mode: Mode,
  options: { provider?: string; model?: string } = {},
): Promise<CaseResult> {
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length) {
    throw new Error('Choose a case from 0 to 7.')
  }
  const { title, locked } = tracks[index]
  const service = musicService(locked)
  let input: InputItem[] = [userMessage(`Play "${title}".`)]
  const calls: CaseResult['calls'] = []
  const usage: CaseResult['usage'] = []
  const traffic: CaseResult['traffic'] = []
  let answer: Answer | null = null

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await askAgent(input, options)
    usage.push(result.usage)
    traffic.push({ request: result.request, response: result.response })
    if (result.functionCalls.length === 0) {
      answer = parseAnswer(result.text)
      break
    }

    const outputs = result.functionCalls.map((call) => {
      const output = runTool(call, mode, service, title)
      calls.push({ name: call.name, args: call.arguments, output })
      return functionOutput(call.callId, output)
    })
    input = [...input, ...continuation(result), ...outputs]
  }

  const state = service.state()

  return {
    title,
    locked,
    answer,
    player: state.playing ?? 'stopped',
    device: state.device,
    calls,
    verdict: grade(answer, state.playing, title),
    usage,
    traffic,
  }
}

/** One step of the agent: the tools, and the answer schema for the app. */
function askAgent(
  input: InputItem[],
  options: { provider?: string; model?: string },
) {
  return createResponse(
    {
      model: options.model,
      instructions: INSTRUCTIONS,
      input,
      tools: TOOLS,
      text: {
        format: {
          type: 'json_schema',
          name: 'playback_report',
          strict: true,
          schema: ANSWER_SCHEMA,
        },
      },
      reasoning: { effort: 'low' },
      max_output_tokens: 1_000,
    },
    { provider: options.provider },
  )
}

/** Runs one tool call on the fake service. Only the requested track exists. */
function runTool(
  call: FunctionCall,
  mode: Mode,
  service: MusicService,
  title: string,
): unknown {
  const args = isObject(call.args) ? call.args : {}
  if (call.name === 'play_track') {
    if (args.track !== title) {
      return { status: 404, error: 'Track not found' }
    }
    return playTrack(mode, service, title)
  }
  if (call.name === 'transfer_playback') {
    return service.transfer(String(args.device ?? ''))
  }

  return { error: `No tool "${call.name}"` }
}

/** All eight tracks at once, each with its own fresh player. */
export async function runPlayer(
  mode: Mode,
  options: { provider?: string; model?: string } = {},
) {
  const rows = await Promise.all(
    cases.map((_, index) => runCase(index, mode, options)),
  )

  return {
    mode,
    rows,
    falseClaims: rows.filter((row) => row.verdict === 'false claim').length,
    usage: sumUsage(rows.flatMap((row) => row.usage)),
  }
}
