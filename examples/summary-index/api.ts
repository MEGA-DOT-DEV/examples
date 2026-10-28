// Functions that the browser page (ui/) calls through `npx mex open`.
// The page builds the index once, then calls run() once per question and
// mode, a few at the same time, and sends index.md back with each index run.
// At the end it sends the totals per mode to verdict().
import { pickProvider, providerInput } from '#shared/llm.ts'
import {
  instructionsFor,
  MAX_RUNS,
  MAX_STEPS,
  MODES,
  modeById,
  runAgent,
  toolsFor,
} from './agent.ts'
import { BATCH_SIZE, buildIndex } from './build.ts'
import { NOTES, NOTES_TOKENS } from './notes.ts'
import { QUESTIONS, questionById } from './questions.ts'
import { verdict as judge, type ModeCost, PROJECT_NOTES } from './verdict.ts'

/** index.md at 40 notes is a few thousand characters; this leaves room for longer lines. */
const MAX_INDEX_CHARS = 40_000

export function setup() {
  return {
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      note: q.note,
      missingWords: q.missingWords ?? [],
      facts: q.facts.map(({ id, label }) => ({ id, label })),
    })),
    modes: MODES.map((m) => ({
      id: m.id,
      label: m.label,
      about: m.about,
      tools: toolsFor(m),
    })),
    notes: NOTES,
    notesTokens: NOTES_TOKENS,
    instructions: instructionsFor(MODES[0]),
    batchSize: BATCH_SIZE,
    maxRuns: MAX_RUNS,
    maxSteps: MAX_STEPS,
    projectNotes: PROJECT_NOTES,
  }
}

export function build(input: { provider?: unknown; model?: unknown }) {
  return buildIndex(providerInput(input))
}

export function run(input: {
  question?: unknown
  mode?: unknown
  index?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = modeById(input.mode)
  const question = questionById(input.question)

  let index: string | undefined
  if (mode.id === 'index') {
    if (typeof input.index !== 'string' || !input.index.trim()) {
      throw new Error('The index mode needs index.md. Build the index first.')
    }
    if (input.index.length > MAX_INDEX_CHARS) {
      throw new Error(`index.md is longer than ${MAX_INDEX_CHARS} characters.`)
    }
    index = input.index
  }

  return runAgent({ mode, question, index, ...providerInput(input) })
}

function count(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a number of 0 or more.`)
  }
  return value
}

/** One object of numbers from the page, as a plain record. */
const fields = (value: unknown) =>
  (value && typeof value === 'object' ? value : {}) as Record<string, unknown>

/** What one mode took, as the page adds it up over its finished runs. */
function readModeCost(value: unknown, mode: string): ModeCost {
  const totals = fields(value)

  return {
    runs: count(totals.runs, `${mode}.runs`),
    requests: count(totals.requests, `${mode}.requests`),
    tokens: count(totals.tokens, `${mode}.tokens`),
    cost: totals.cost === null ? null : count(totals.cost, `${mode}.cost`),
  }
}

export function verdict(input: {
  build?: unknown
  grep?: unknown
  index?: unknown
  provider?: unknown
  model?: unknown
}) {
  const built = fields(input.build)
  const { provider, model } = providerInput(input)
  if (!model) {
    throw new Error('The verdict needs the model the runs used.')
  }

  return judge({
    build: {
      cost: built.cost === null ? null : count(built.cost, 'build.cost'),
      tokens: count(built.tokens, 'build.tokens'),
      tokensPerNote: count(built.tokensPerNote, 'build.tokensPerNote'),
      notes: Math.max(1, count(built.notes, 'build.notes')),
    },
    grep: readModeCost(input.grep, 'grep'),
    index: readModeCost(input.index, 'index'),
    provider: pickProvider(provider),
    model,
  })
}
