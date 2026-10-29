// Functions that the browser page (ui/) calls through `npx mex open`.
// The page sends one run() call per mode and run, all at once, so each run
// shows as soon as it is done.
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { mine, transcriptsText } from './mine.ts'
import {
  DEFAULT_EFFORT,
  DEFAULT_RUNS,
  EFFORTS,
  INSTRUCTIONS,
  inputFor,
  MAX_RUNS,
  MODE_NAMES,
  MODES,
  runMode,
} from './propose.ts'
import {
  ONE_OFF_SESSIONS,
  RUN_DATE,
  SEEDED,
  SESSIONS,
  SKILLS,
} from './sessions.ts'

export function setup() {
  const mined = mine(SESSIONS)

  return {
    runDate: RUN_DATE,
    skills: SKILLS,
    sessions: SESSIONS.map((s) => ({
      id: s.id,
      date: s.date,
      skills: s.skills,
    })),
    transcripts: transcriptsText(SESSIONS),
    seeded: SEEDED.map(({ id, about, expect }) => ({ id, about, expect })),
    oneOffSessions: ONE_OFF_SESSIONS,
    script: {
      loads: mined.loads.length,
      corrections: mined.corrections.length,
      followUps: mined.followUps,
      ms: mined.ms,
    },
    instructions: INSTRUCTIONS,
    inputs: { all: inputFor('all'), script: inputFor('script') },
    modes: MODES.map((id) => ({ id, name: MODE_NAMES[id] })),
    efforts: EFFORTS,
    effort: DEFAULT_EFFORT,
    runs: DEFAULT_RUNS,
    maxRuns: MAX_RUNS,
  }
}

/** One run of one mode: one request, scored against the seeded patterns. */
export function run(input: {
  mode?: unknown
  effort?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = oneOf(input.mode, MODES, 'mode')
  if (!mode) {
    throw new Error(`Send a mode: ${MODES.join(' or ')}.`)
  }
  const effort = oneOf(input.effort, EFFORTS, 'effort') ?? DEFAULT_EFFORT

  return runMode(mode, { effort, ...providerInput(input) })
}
