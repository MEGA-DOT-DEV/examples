// Functions that the browser page (ui/) calls through `npx mex open`.
// pictures() draws the pictures and makes no request. The page calls run()
// once per picture and detail, a few at the same time, so each answer shows
// as soon as it arrives.
import { byId, wholeNumber } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { MAX_SEED, MODES, picturesOf, runProbe, schemaFor } from './probe.ts'
import { imageUrl, MAX_PER_TASK, makePicture, SIZE, TASKS } from './tasks.ts'

export function setup() {
  return {
    modes: MODES,
    tasks: TASKS.map(({ id, name, short, fields }) => ({
      id,
      name,
      short,
      fields: fields.map(({ id, label }) => ({ id, label })),
    })),
    schemas: Object.fromEntries(TASKS.map((t) => [t.id, schemaFor(t)])),
    maxPerTask: MAX_PER_TASK,
    maxSeed: MAX_SEED,
    size: SIZE,
  }
}

/** The pictures of a seed: the image, the question, the key and what makes it hard. No request. */
export function pictures(input: { seed?: unknown; perTask?: unknown }) {
  const seed = wholeNumber(input.seed, 'The seed', 1, MAX_SEED)
  const perTask = wholeNumber(
    input.perTask,
    'Pictures per task',
    1,
    MAX_PER_TASK,
  )
  if (seed === undefined || perTask === undefined) {
    throw new Error('Send a seed and a number of pictures per task.')
  }

  return picturesOf(seed, perTask).map((p) => ({
    task: p.task,
    number: p.number,
    image: imageUrl(p),
    question: p.question,
    key: p.key,
    note: p.note,
  }))
}

/** One picture at one detail: one request, scored against the key. */
export function run(input: {
  seed?: unknown
  task?: unknown
  number?: unknown
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const seed = wholeNumber(input.seed, 'The seed', 1, MAX_SEED)
  const task = byId(TASKS, input.task, 'task')
  const number = wholeNumber(
    input.number,
    'The picture number',
    1,
    MAX_PER_TASK,
  )
  const mode = byId(MODES, input.mode, 'mode')
  if (!seed || !task || !number || !mode) {
    throw new Error('Send a seed, a task, a picture number and a mode.')
  }

  return runProbe({
    picture: makePicture(seed, task.id, number),
    mode,
    ...providerInput(input),
  })
}
