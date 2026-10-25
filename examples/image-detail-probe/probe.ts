// The probe: one question about one picture, asked at two levels of image
// detail. The picture, the question and the answer schema stay the same.
// Only the `detail` of the input_image changes:
//
//   low    the provider gives the model a smaller copy of the image
//   high   the provider keeps more of its pixels
//
// Code scores each answer against the key that the generator computed from
// the geometry. Every value must equal the key.

import { byId, wholeNumber } from '#shared/input.ts'
import { check, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  type InputItem,
  pickProvider,
  type ShownRequest,
  sumUsage,
  type Usage,
} from '#shared/llm.ts'
import { mapLimit } from '#shared/pool.ts'
import type { ProviderId } from '#shared/providers.ts'
import {
  imageUrl,
  MAX_PER_TASK,
  makePicture,
  type Picture,
  TASKS,
  type Task,
  type TaskId,
  type Value,
} from './tasks.ts'

export type ModeId = 'low' | 'high'

export interface Mode {
  id: ModeId
  label: string
  /** The `detail` of the input_image. "auto" lets the provider choose. */
  detail: 'low' | 'high' | 'auto'
}

export const MODES: Mode[] = [
  { id: 'low', label: 'Low detail', detail: 'low' },
  { id: 'high', label: 'High detail', detail: 'high' },
]

/** The answer schema of a task: one field per value, all required (structured output, strict). */
export function schemaFor(task: Task): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: task.fields.map((f) => f.id),
    properties: Object.fromEntries(task.fields.map((f) => [f.id, f.schema])),
  }
}

/** The user message for one picture in one mode: the question, then the image. The modes differ only in `detail`. */
export function messageFor(picture: Picture, mode: Mode): InputItem {
  return {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: picture.question },
      {
        type: 'input_image',
        image_url: imageUrl(picture),
        detail: mode.detail,
      },
    ],
  }
}

// ── Scoring ────────────────────────────────────────────────────────────

export interface Check {
  field: string
  /** The row name: "Crossings", "Rows". */
  label: string
  expected: Value
  /** What the model said, or null when there is no valid answer. */
  got: Value | null
  ok: boolean
}

/** Equal to the key: the same number, the same word in any case, or the same set of words in any order. */
export function same(expected: Value, got: Value): boolean {
  const words = (v: string[]) =>
    [...new Set(v.map((w) => w.trim().toLowerCase()))].sort().join()

  if (Array.isArray(expected)) {
    return Array.isArray(got) && words(got) === words(expected)
  }

  if (typeof expected === 'string') {
    return (
      typeof got === 'string' &&
      got.trim().toLowerCase() === expected.toLowerCase()
    )
  }

  return got === expected
}

export function score(
  picture: Picture,
  answer: Record<string, Value> | null,
): Check[] {
  return byId(TASKS, picture.task, 'task').fields.map((f) => {
    const got = answer ? answer[f.id] : null
    return {
      field: f.id,
      label: f.label,
      expected: picture.key[f.id],
      got,
      ok: got !== null && same(picture.key[f.id], got),
    }
  })
}

// ── One request ────────────────────────────────────────────────────────

export interface ProbeRun {
  task: TaskId
  picture: number
  mode: ModeId
  provider: ProviderId
  model: string
  ms: number
  usage: Usage
  answer: Record<string, Value> | null
  /** Why there is no answer: the JSON did not parse or did not fit the schema. */
  problem: string | null
  checks: Check[]
  request: ShownRequest
  response: unknown
}

/** The shown request with the base64 image cut short, so a page or a log can show it. */
export function shortenImages(request: ShownRequest): ShownRequest {
  return JSON.parse(
    JSON.stringify(request, (key, value) =>
      key === 'image_url' && typeof value === 'string' && value.length > 80
        ? `${value.slice(0, 40)}… (${value.length} characters)`
        : value,
    ),
  )
}

export async function runProbe(options: {
  picture: Picture
  mode: Mode
  provider?: string
  model?: string
}): Promise<ProbeRun> {
  const { picture, mode } = options
  const schema = schemaFor(byId(TASKS, picture.task, 'task'))
  const result = await createResponse(
    {
      model: options.model,
      input: [messageFor(picture, mode)],
      text: {
        format: {
          type: 'json_schema',
          name: `${picture.task}_answer`,
          strict: true,
          schema,
        },
      },
      reasoning: { effort: 'low' },
      max_output_tokens: 8_000,
    },
    { provider: options.provider },
  )

  let answer: Record<string, Value> | null = null
  let problem: string | null = null
  try {
    const parsed = JSON.parse(result.text)
    const checked = check(schema, parsed)
    if (checked.ok) {
      answer = parsed
    } else {
      problem = `The answer does not fit the schema: ${checked.errors.join('; ')}`
    }
  } catch {
    problem =
      result.status === 'incomplete'
        ? `The answer stopped early (${result.incompleteReason}).`
        : 'The answer is not valid JSON.'
  }

  return {
    task: picture.task,
    picture: picture.number,
    mode: mode.id,
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    usage: result.usage,
    answer,
    problem,
    checks: score(picture, answer),
    request: shortenImages(result.request),
    response: result.response,
  }
}

// ── Every picture at every detail ──────────────────────────────────────

export interface ModeSummary {
  mode: Mode
  /** One per picture, in the order of `pictures`. */
  runs: PromiseSettledResult<ProbeRun>[]
  done: ProbeRun[]
  /** Right values and all values per task, over every picture that came back. */
  right: Record<TaskId, number>
  total: Record<TaskId, number>
  /** The usage of every picture that came back, added up. */
  usage: Usage
  ms: number
}

export function summarize(
  mode: Mode,
  runs: PromiseSettledResult<ProbeRun>[],
): ModeSummary {
  const done = runs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))

  const sum = (pick: (r: ProbeRun) => number) =>
    done.reduce((n, r) => n + pick(r), 0)
  const perTask = (pick: (c: ProbeRun['checks']) => number) =>
    Object.fromEntries(
      TASKS.map((t) => [
        t.id,
        sum((r) => (r.task === t.id ? pick(r.checks) : 0)),
      ]),
    ) as Record<TaskId, number>

  return {
    mode,
    runs,
    done,
    right: perTask((checks) => checks.filter((c) => c.ok).length),
    total: perTask((checks) => checks.length),
    usage: sumUsage(done.map((r) => r.usage)),
    ms: sum((r) => r.ms),
  }
}

export const MAX_SEED = 99_999

/** The pictures of a seed: `perTask` pictures of each task, task by task. */
export function picturesOf(
  seed: number,
  perTask: number,
  tasks: Task[] = TASKS,
): Picture[] {
  wholeNumber(seed, 'The seed', 1, MAX_SEED)
  wholeNumber(perTask, 'Pictures per task', 1, MAX_PER_TASK)

  return tasks.flatMap((t) =>
    Array.from({ length: perTask }, (_, i) => makePicture(seed, t.id, i + 1)),
  )
}

/** Every picture at every detail, at most 6 requests at the same time. */
export async function compare(options: {
  seed: number
  perTask: number
  tasks?: Task[]
  modes?: Mode[]
  provider?: string
  model?: string
}): Promise<{ pictures: Picture[]; summaries: ModeSummary[] }> {
  const modes = options.modes ?? MODES
  const pictures = picturesOf(options.seed, options.perTask, options.tasks)

  // Check the key once, before any request.
  const provider = pickProvider(options.provider)
  const jobs = modes.flatMap((mode) =>
    pictures.map((picture) => ({ mode, picture })),
  )

  const results = await mapLimit(jobs.length, 6, (i) =>
    runProbe({ ...jobs[i], provider, model: options.model }),
  )

  return {
    pictures,
    summaries: modes.map((mode, i) =>
      summarize(
        mode,
        results.slice(i * pictures.length, (i + 1) * pictures.length),
      ),
    ),
  }
}
