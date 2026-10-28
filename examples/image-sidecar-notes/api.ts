// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls intake() once, then run() per question and mode, a few at
// the same time, so each answer shows as soon as its run ends. The sidecar
// mode gets the sidecar notes back from the page with each run.
import { providerInput } from '#shared/llm.ts'
import {
  INSTRUCTIONS,
  MAX_STEPS,
  MODES,
  modeById,
  runAgent,
  SAME_COST,
} from './agent.ts'
import { grepFiles, makeBase, NOTES, toolDefinitions } from './base.ts'
import { IMAGES } from './images.ts'
import {
  intake as runIntake,
  SIDECAR_INSTRUCTIONS,
  sidecarTexts,
} from './intake.ts'
import { QUESTIONS, questionById } from './questions.ts'

const MAX_SIDECAR_CHARS = 4_000

export function setup() {
  const before = makeBase()

  return {
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      source: q.source,
      image: q.image,
      // For each fact: the files a grep finds before intake. Empty for every image fact.
      facts: q.facts.map((f) => ({
        id: f.id,
        label: f.label,
        before: grepFiles(before, f.test),
      })),
    })),
    modes: MODES,
    notes: NOTES.map((n) => ({ path: n.path, title: n.title, text: n.text })),
    images: IMAGES.map((i) => ({
      path: i.path,
      title: i.title,
      width: i.width,
      height: i.height,
      url: i.url,
    })),
    instructions: INSTRUCTIONS,
    sidecarInstructions: SIDECAR_INSTRUCTIONS,
    tools: toolDefinitions(true),
    maxSteps: MAX_STEPS,
    sameCost: SAME_COST,
  }
}

/** One vision request per image. Returns the sidecars, and per image fact the files a grep finds after intake. */
export async function intake(input: { provider?: unknown; model?: unknown }) {
  const done = await runIntake(providerInput(input))
  const after = makeBase(sidecarTexts(done))
  const found = Object.fromEntries(
    QUESTIONS.filter((q) => q.image).flatMap((q) =>
      q.facts.map((f) => [f.id, grepFiles(after, f.test)]),
    ),
  )

  return { ...done, found }
}

/** The sidecar texts the page sends back: one string per known image, nothing else. */
function readSidecars(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'The sidecar mode needs the sidecar notes: run the intake first.',
    )
  }

  const sidecars: Record<string, string> = {}
  for (const [path, text] of Object.entries(value)) {
    if (!IMAGES.some((i) => i.path === path)) {
      throw new Error(`No image at "${path}".`)
    }
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > MAX_SIDECAR_CHARS
    ) {
      throw new Error(
        `The sidecar of ${path} must be text of 1 to ${MAX_SIDECAR_CHARS} characters.`,
      )
    }
    sidecars[path] = text
  }

  return sidecars
}

export function run(input: {
  question?: unknown
  mode?: unknown
  sidecars?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = modeById(input.mode)
  const base = makeBase(
    mode.id === 'sidecar' ? readSidecars(input.sidecars) : {},
  )

  return runAgent({
    question: questionById(input.question),
    mode,
    base,
    ...providerInput(input),
  })
}
