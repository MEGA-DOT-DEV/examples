// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls ask() or latest() once per question, so each answer shows as it arrives.
import { providerInput } from '#shared/llm.ts'
import {
  aliceVerdict,
  askLatest,
  ask as askModel,
  BOOK_WORDS,
  FAKE_PACKAGE,
  HEDGE_WORDS,
  LATEST_PACKAGE,
  PROBES,
  registryCheck,
  VERDICT_TEXT,
  versionLine,
  versionSummary,
} from './probe.ts'

export function probes() {
  return {
    probes: PROBES,
    fakePackage: FAKE_PACKAGE,
    latestPackage: LATEST_PACKAGE,
    bookWords: BOOK_WORDS,
    hedgeWords: HEDGE_WORDS,
  }
}

export async function ask(input: {
  question?: unknown
  context?: unknown
  provider?: unknown
  model?: unknown
}) {
  const answer = await askModel({
    question: typeof input.question === 'string' ? input.question : '',
    context: typeof input.context === 'string' ? input.context : '',
    ...providerInput(input),
  })

  const verdict = aliceVerdict(answer)
  return { ...answer, verdict, verdictText: VERDICT_TEXT[verdict] }
}

/** The public npm registry, for the made-up package only. No key needed. */
export function registry() {
  return registryCheck(FAKE_PACKAGE)
}

/** Asks for the latest version of the package, and reads the real one from the npm registry. */
export async function latest(input: { provider?: unknown; model?: unknown }) {
  const answer = await askLatest(providerInput(input))

  return {
    ...answer,
    versionLine: versionLine(answer.version),
    summary: versionSummary(answer.version),
  }
}
