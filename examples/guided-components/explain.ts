// One explainer note per request. The topic, the facts and the format rules
// stay the same in both modes. Only the guidance changes:
//
//   free     components are allowed; the model picks names and props
//   guided   the instructions also hold the library (names, when to use each,
//            props schemas) and one template
//
// Code then checks each note: does it parse, does it use only known
// components, do their props pass check(), are the key points still there.
import { byId, wholeNumber } from '#shared/input.ts'
import {
  createResponse,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  type Component,
  type ContentKind,
  checkNote,
  LIBRARY,
  LIBRARY_TEXT,
  type NoteCheck,
  TEMPLATE,
} from './library.ts'
import { type Parsed, parse, unwrapFence } from './svx.ts'
import { briefText, TOPICS, type Topic } from './topics.ts'

export type ModeId = 'free' | 'guided'

export interface Mode {
  id: ModeId
  label: string
  about: string
}

export const MODES: Mode[] = [
  {
    id: 'free',
    label: 'Free',
    about: 'Components are allowed. The model picks their names and props.',
  },
  {
    id: 'guided',
    label: 'Guided',
    about:
      'The instructions also hold a library of three components with props schemas, and one template.',
  },
]

export const MAX_RUNS = 5
export const DEFAULT_RUNS = 2
/** Notes written at the same time. */
export const AT_ONCE = 4

/** The mode with this id. A note needs one, so a missing id is wrong too. */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

// The format rules are in both modes, so a parse failure means the same in each.
const FORMAT = `You write explainer notes for a team knowledge base as .svx files: Markdown with components.

Format rules, so that code can read and render the file:
- Start with frontmatter between two --- lines: "key: value" lines, at least a title.
- Write the body in Markdown.
- A component is a self-closing tag with a capitalized name, on its own lines: <Name prop={JSON} />. Each prop value is JSON in braces, or a "string" in quotes. No <script> blocks, no variables, no children.
- Return only the file: no code fence around it, nothing before or after it.`

const FREE =
  'Use components where they help the reader. Choose their names and props yourself.'

const GUIDED = `Use components from this library. For each part of the content, pick the component whose "Use for" fits it. Its props must match its schema.

${LIBRARY_TEXT}

Start from this template. It is a starting shape, not a limit: keep every fact from the request, and add Markdown, sections or more components where the content needs them.

${TEMPLATE}`

export const instructionsFor = (mode: Mode) =>
  `${FORMAT}\n\n${mode.id === 'guided' ? GUIDED : FREE}`

export interface PointScore {
  id: string
  label: string
  covered: boolean
}

export interface NoteRun {
  topic: string
  kind: ContentKind
  mode: ModeId
  provider: ProviderId
  model: string
  status: string
  ms: number
  /** The note as the model wrote it, without a wrapping code fence. */
  note: string
  parsed: Parsed
  check: NoteCheck
  points: PointScore[]
  usage: Usage
  request: unknown
  response: unknown
}

export async function writeNote(options: {
  topic: Topic
  mode: Mode
  provider?: string
  model?: string
}): Promise<NoteRun> {
  const { topic, mode } = options
  const provider = pickProvider(options.provider)

  const result = await createResponse(
    {
      model: options.model,
      instructions: instructionsFor(mode),
      input: [userMessage(briefText(topic))],
      reasoning: { effort: 'low' },
      max_output_tokens: 4_000,
    },
    { provider },
  )

  const note = unwrapFence(result.text)
  const parsed = parse(note)

  return {
    topic: topic.id,
    kind: topic.kind,
    mode: mode.id,
    provider,
    model: result.model,
    status: result.status,
    ms: result.ms,
    note,
    parsed,
    check: checkNote(parsed, topic.kind),
    // Key points are looked for in the whole note: prose and props.
    points: topic.points.map((p) => ({
      id: p.id,
      label: p.label,
      covered: p.test(note),
    })),
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

export interface KindConsistency {
  kind: ContentKind
  expected: string
  runs: number
  /** Runs whose note uses the expected component for this kind of content. */
  expectedUsed: number
  /** Every component name the notes of this kind used. */
  names: string[]
}

export interface ModeSummary {
  mode: Mode
  runs: PromiseSettledResult<NoteRun>[]
  done: NoteRun[]
  parsed: number
  unknownTags: number
  unknownNames: string[]
  knownTags: number
  validTags: number
  points: number
  possiblePoints: number
  kinds: KindConsistency[]
  /** Every component name the mode's notes used. */
  names: string[]
  /** Every component-and-prop-names shape the mode's notes used. More shapes: more renderers to write. */
  shapes: string[]
  usage: Usage
  ms: number
}

/** The numbers per mode. A run that failed (an API error) counts in none of them. */
export function summarize(
  mode: Mode,
  runs: PromiseSettledResult<NoteRun>[],
): ModeSummary {
  const done = runs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const sum = (count: (run: NoteRun) => number) =>
    done.reduce((total, run) => total + count(run), 0)
  const sorted = (names: string[]) => [...new Set(names)].sort()

  return {
    mode,
    runs,
    done,
    parsed: done.filter((r) => r.check.parsed).length,
    unknownTags: sum((r) => r.check.tags.filter((t) => !t.known).length),
    unknownNames: sorted(done.flatMap((r) => r.check.unknown)),
    knownTags: sum((r) => r.check.knownTags),
    validTags: sum((r) => r.check.validTags),
    points: sum((r) => r.points.filter((p) => p.covered).length),
    possiblePoints: sum((r) => r.points.length),
    kinds: LIBRARY.map((component) => consistency(component, done)),
    names: sorted(done.flatMap((r) => r.check.components)),
    shapes: sorted(done.flatMap((r) => r.check.tags.map((t) => t.shape))),
    usage: sumUsage(done.map((r) => r.usage)),
    ms: sum((r) => r.ms),
  }
}

/** How the notes of one kind of content used the library component for it. */
function consistency(component: Component, done: NoteRun[]): KindConsistency {
  const ofKind = done.filter((r) => r.kind === component.kind)
  const names = ofKind.flatMap((r) => r.check.components)

  return {
    kind: component.kind,
    expected: component.name,
    runs: ofKind.length,
    expectedUsed: ofKind.filter((r) => r.check.expectedUsed).length,
    names: [...new Set(names)].sort(),
  }
}

/** Every mode × every topic × `runs`, at most AT_ONCE requests at the same time. */
export async function compare(options: {
  modes?: Mode[]
  topics?: Topic[]
  runs?: number
  provider?: string
  model?: string
}): Promise<ModeSummary[]> {
  const modes = options.modes ?? MODES
  const topics = options.topics ?? TOPICS
  const runs = wholeNumber(options.runs ?? DEFAULT_RUNS, 'Runs', 1, MAX_RUNS)
  // Check the key once, before any request.
  const provider = pickProvider(options.provider)

  const notes = modes.flatMap((mode) =>
    topics.flatMap((topic) =>
      Array.from({ length: runs }, () => ({ mode, topic })),
    ),
  )
  const results = await mapLimit(notes.length, AT_ONCE, (index) =>
    writeNote({ ...notes[index], provider, model: options.model }),
  )

  const perMode = topics.length * runs

  return modes.map((mode, index) =>
    summarize(mode, results.slice(index * perMode, (index + 1) * perMode)),
  )
}
