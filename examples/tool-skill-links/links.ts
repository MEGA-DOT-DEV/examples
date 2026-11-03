// One image tool and three style skills on one server. The agent finds a
// skill only when it looks: list_skills, then load_skill. Only the text
// changes between the two modes: in "linked", the tool names the skills, and
// each skill names the tool and its arguments.
import { byId } from '#shared/input.ts'
import {
  type FunctionTool,
  type InputItem,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { model as defaultModel } from '#shared/providers.ts'
import { type AgentStep, runStep, type Tool } from '../agent-loop/agent.ts'

export const MODES = [
  {
    id: 'unlinked',
    label: 'No links',
    about: 'The tool and the skills do not mention each other.',
  },
  {
    id: 'linked',
    label: 'Linked',
    about:
      'The tool names the style skills. Each skill names the tool and its arguments.',
  },
] as const
export type Mode = (typeof MODES)[number]['id']

export interface ImageArgs {
  width: number
  height: number
  colors: number
  smoothing: boolean
}
export type ImageCall = ImageArgs & { prompt: string }
const ARG_NAMES: (keyof ImageArgs)[] = [
  'width',
  'height',
  'colors',
  'smoothing',
]
export const DEFAULTS: ImageArgs = {
  width: 1024,
  height: 1024,
  colors: 0,
  smoothing: true,
}

// The house styles. The numbers are not common defaults, so a model cannot guess them.
export const SKILLS = [
  {
    id: 'pixel-art',
    about: 'Pixel art house style for game sprites.',
    look: 'hard pixel edges',
    args: { width: 96, height: 96, colors: 12, smoothing: false },
  },
  {
    id: 'blueprint',
    about: 'Blueprint house style for technical drawings.',
    look: 'white lines on blue',
    args: { width: 1600, height: 1000, colors: 2, smoothing: true },
  },
  {
    id: 'watercolor',
    about: 'Watercolor house style for illustrations.',
    look: 'soft washes of color',
    args: { width: 1200, height: 1500, colors: 0, smoothing: true },
  },
] as const satisfies readonly {
  id: string
  about: string
  look: string
  args: ImageArgs
}[]
export type SkillId = (typeof SKILLS)[number]['id']

/**
 * What a request needs. "style": the skill, then the tool with the skill's
 * arguments. "tool": the tool alone, no skill. "skill": the skill alone, no image.
 */
export type Need = 'style' | 'tool' | 'skill'
export type ImageRequest =
  | { text: string; need: 'tool'; skill: null }
  | { text: string; need: 'style' | 'skill'; skill: SkillId }
export const REQUESTS: ImageRequest[] = [
  {
    text: 'Make a pixel-art sprite of a fox for our game.',
    need: 'style',
    skill: 'pixel-art',
  },
  {
    text: 'Make a blueprint drawing of a bicycle for the wiki.',
    need: 'style',
    skill: 'blueprint',
  },
  {
    text: 'Make a watercolor of the office at sunset for the newsletter.',
    need: 'style',
    skill: 'watercolor',
  },
  {
    text: 'Make a photo of a red apple on a wooden table.',
    need: 'tool',
    skill: null,
  },
  {
    text: 'Which canvas size and how many colors does our pixel-art style use? Do not make an image.',
    need: 'skill',
    skill: 'pixel-art',
  },
]

/** The skill description that list_skills returns. */
export function skillAbout(id: SkillId, mode: Mode): string {
  const skill = byId(SKILLS, id, 'skill')

  return mode === 'linked'
    ? `${skill.about} Use it with generate_image.`
    : skill.about
}

/** The skill text that load_skill returns. Both hold the same style; only the linked text names the tool and its arguments. */
export function skillText(id: SkillId, mode: Mode): string {
  const skill = byId(SKILLS, id, 'skill')
  const { width, height, colors, smoothing } = skill.args
  if (mode === 'unlinked') {
    return `# ${skill.id}\n${skill.about} Canvas ${width} × ${height} px, ${colors ? `${colors} colors` : 'no color limit'}, ${smoothing ? 'smooth edges' : 'no smoothing'}. Look: ${skill.look}.`
  }

  return `# ${skill.id}\n${skill.about} Use it with the generate_image tool. Set these arguments: width ${width}, height ${height}, colors ${colors}, smoothing ${smoothing}. Look: ${skill.look}; put the subject in the prompt.`
}

export function imageTool(mode: Mode): FunctionTool {
  // The link from the tool to the skills. It allows the tool alone, too.
  const link =
    mode === 'linked'
      ? ` Style skills can be used with this tool: ${SKILLS.map((skill) => skill.id).join(', ')}. For one of these styles, load its skill with load_skill first: it holds the exact arguments. A plain image needs no skill.`
      : ''

  return {
    type: 'function',
    name: 'generate_image',
    strict: true,
    description: `Generate an image and return its id.${link}`,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the image shows.' },
        width: {
          type: 'integer',
          description: `Width in pixels. Default ${DEFAULTS.width}.`,
        },
        height: {
          type: 'integer',
          description: `Height in pixels. Default ${DEFAULTS.height}.`,
        },
        colors: {
          type: 'integer',
          description:
            'Number of colors in the palette. 0 means no limit. Default 0.',
        },
        smoothing: {
          type: 'boolean',
          description: 'Smooth the edges. Default true.',
        },
      },
      required: ['prompt', 'width', 'height', 'colors', 'smoothing'],
      additionalProperties: false,
    },
  }
}

const LIST_SKILLS: FunctionTool = {
  type: 'function',
  name: 'list_skills',
  strict: true,
  description: 'List the skills on this server: id and description.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
}
const LOAD_SKILL: FunctionTool = {
  type: 'function',
  name: 'load_skill',
  strict: true,
  description: 'Load a skill by its id and return its text.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
}
export const INSTRUCTIONS = 'You make images for the team with your tools.'

export interface ArgCheck {
  name: keyof ImageArgs
  want: number | boolean
  got: number | boolean | null
  pass: boolean
}
export interface Outcome {
  request: ImageRequest
  loaded: SkillId[]
  call: ImageCall | null
  checks: ArgCheck[]
  pass: boolean
  steps: AgentStep[]
}

/** Scores one request in code, from the skills that loaded and the arguments that reached the tool. */
export function score(
  request: ImageRequest,
  loaded: SkillId[],
  call: ImageCall | null,
): { checks: ArgCheck[]; pass: boolean } {
  if (request.need === 'tool') {
    return { checks: [], pass: loaded.length === 0 && call !== null }
  }
  if (request.need === 'skill') {
    return {
      checks: [],
      pass: loaded.includes(request.skill) && call === null,
    }
  }

  const want = byId(SKILLS, request.skill, 'skill').args
  const checks = ARG_NAMES.map((name) => ({
    name,
    want: want[name],
    got: call ? call[name] : null,
    pass: call?.[name] === want[name],
  }))

  return {
    checks,
    pass: loaded.includes(request.skill) && checks.every((check) => check.pass),
  }
}

export interface RequestRun {
  mode: Mode
  provider: string
  model: string
  outcome: Outcome
  usage: Usage
}
const MAX_STEPS = 5

/** What the agent did on the server: the skills it loaded and the image call. */
interface Seen {
  loaded: SkillId[]
  call: ImageCall | null
}

/** Runs one request. The agent may look up skills, then calls generate_image. The stub draws nothing. */
export async function runRequest(
  mode: Mode,
  index: number,
  options: { provider?: string; model?: string } = {},
): Promise<RequestRun> {
  const request = REQUESTS[index]
  if (!request) {
    throw new Error(`No request ${index}.`)
  }
  const provider = pickProvider(options.provider)
  const model = options.model || defaultModel(provider)
  const seen: Seen = { loaded: [], call: null }
  const tools = serverTools(mode, seen)
  let input: InputItem[] = [userMessage(request.text)]
  const steps: AgentStep[] = []

  for (let number = 1; number <= MAX_STEPS; number++) {
    const { step, added, end } = await runStep({
      input,
      instructions: INSTRUCTIONS,
      tools,
      number,
      maxSteps: MAX_STEPS,
      provider,
      model,
      reasoning: 'low',
    })
    steps.push(step)
    input = [...input, ...added]
    // The image call is what this example checks, so the run ends once it happened.
    if (end || seen.call) {
      break
    }
  }

  const { loaded, call } = seen
  const { checks, pass } = score(request, loaded, call)

  return {
    mode,
    provider,
    model,
    outcome: { request, loaded, call, checks, pass, steps },
    usage: sumUsage(steps.map((step) => step.usage)),
  }
}

/** The three tools of the server. They record what the agent does in `seen`. */
function serverTools(mode: Mode, seen: Seen): Tool[] {
  return [
    {
      definition: LIST_SKILLS,
      run: () =>
        SKILLS.map((skill) => ({
          id: skill.id,
          description: skillAbout(skill.id, mode),
        })),
    },
    {
      definition: LOAD_SKILL,
      run: (args: { id?: unknown }) => {
        const skill = SKILLS.find((item) => item.id === args.id)
        if (!skill) {
          throw new Error(`No skill "${String(args.id)}". Call list_skills.`)
        }
        seen.loaded.push(skill.id)

        return skillText(skill.id, mode)
      },
    },
    // The stub records the arguments. That is all this example checks.
    {
      definition: imageTool(mode),
      run: (args: ImageCall) => {
        seen.call = args
        return { image_id: 'img_001' }
      },
    },
  ]
}

export interface ModeRun {
  mode: Mode
  model: string
  outcomes: Outcome[]
  passed: number
  requests: number
  usage: Usage
}

/** All requests in one mode, in parallel. */
export async function runMode(
  mode: Mode,
  options: { provider?: string; model?: string } = {},
): Promise<ModeRun> {
  const runs = await Promise.all(
    REQUESTS.map((_, index) => runRequest(mode, index, options)),
  )

  return {
    mode,
    model: runs[0].model,
    outcomes: runs.map((run) => run.outcome),
    passed: runs.filter((run) => run.outcome.pass).length,
    requests: runs.reduce((sum, run) => sum + run.outcome.steps.length, 0),
    usage: sumUsage(runs.map((run) => run.usage)),
  }
}
