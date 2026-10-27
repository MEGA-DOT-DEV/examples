// Functions that the browser page (ui/) calls through `npx mex open`.
// setup() makes no request: it gives the tasks and the guidance of each mode.
// run() sends one format's task in the three modes.
import { MissingKeyError } from '#shared/env.ts'
import { oneOf } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import {
  BASE_INSTRUCTIONS,
  compare,
  FORMATS,
  MODE_LABELS,
  versions,
} from './anchors.ts'

// The page starts on Gherkin: in a test run, the answer without guidance missed
// the format, and the name alone passed. One click shows the effect.
const PAGE_DEFAULT = 'Gherkin'

export function setup() {
  return {
    // Each format with what the page shows before a run: the task and the guidance of each mode.
    formats: FORMATS.map((format) => ({
      name: format.name,
      task: format.task,
      versions: versions(format).map((version) => ({
        ...version,
        label: MODE_LABELS[version.mode],
      })),
    })),
    selected: PAGE_DEFAULT,
    base: BASE_INSTRUCTIONS,
  }
}

export async function run(input: {
  format?: unknown
  provider?: unknown
  model?: unknown
}) {
  const names = FORMATS.map((format) => format.name)
  const format = oneOf(input?.format, names, 'format')
  if (!format) {
    throw new Error('Choose a known format.')
  }

  try {
    return await compare({ ...providerInput(input), formats: [format] })
  } catch (error) {
    if (error instanceof MissingKeyError) {
      throw error
    }
    throw new Error(errorText(error))
  }
}
