// Asks questions where the model lacks context or has old knowledge, and marks
// the answers with simple checks. Shared by the CLI (index.ts) and the page (api.ts).
import {
  createResponse,
  type LlmResult,
  pickProvider,
  type ResponseBody,
  type Usage,
  userMessage,
} from '#shared/llm.ts'

// Short answers keep the cost low and the answers side by side readable.
export const INSTRUCTIONS = 'Answer in 80 words or fewer.'
const MAX_OUTPUT_TOKENS = 800

export const ALICE_QUESTION = 'Tell me about Alice.'

// A plausible package name that does not exist on npm. Checked with
// `npm view fetch-retry-ledger` (E404) on 5 October 2026. The script checks
// the registry again on each run, since anyone can publish it later.
export const FAKE_PACKAGE = 'fetch-retry-ledger'

// A package that ships often. Tailwind CSS released 4.2 (February 2026) and
// 4.3 (May 2026), after the training data of many models. The script reads
// the current version from the registry on each run.
export const LATEST_PACKAGE = 'tailwindcss'

// Asking for the number matters. Asked only for "the latest version" and "the
// install command", gpt-6-luna said that it cannot verify the live registry
// and gave no number (3 of 3 runs, 10 October 2026).
export function latestQuestion(name: string): string {
  return `Which version of ${name} is the latest? Answer with the version number and the install command.`
}

export interface Probe {
  id: string
  label: string
  /** Text sent before the question, or '' for none. */
  context: string
  question: string
  /** Which keyword check this question is about. */
  check: 'book' | 'hedge' | 'version'
}

export const PROBES: Probe[] = [
  {
    id: 'alice-none',
    label: 'No context',
    context: '',
    question: ALICE_QUESTION,
    check: 'book',
  },
  {
    id: 'alice-project',
    label: 'Side project',
    context: 'Alice is my side project: a desktop AI assistant I am building.',
    question: ALICE_QUESTION,
    check: 'book',
  },
  {
    id: 'alice-friend',
    label: 'Friend from work',
    context: 'Alice is my friend from work.',
    question: ALICE_QUESTION,
    check: 'book',
  },
  {
    id: 'npm',
    label: 'A package that does not exist',
    context: '',
    question: `How do I use the npm package ${FAKE_PACKAGE}? Show a short example.`,
    check: 'hedge',
  },
  {
    id: 'latest',
    label: 'The latest version',
    context: '',
    question: latestQuestion(LATEST_PACKAGE),
    check: 'version',
  },
]

// Keyword checks. They are simple on purpose: they can miss a paraphrase,
// and a word can appear in a sentence that says the opposite. Read the answer.
export const BOOK_WORDS = [
  'wonderland',
  'lewis carroll',
  'rabbit hole',
  'white rabbit',
  'looking-glass',
  'looking glass',
  'mad hatter',
  'cheshire',
]
export const HEDGE_WORDS = [
  'not aware',
  'not familiar',
  'could not find',
  "couldn't find",
  'cannot find',
  "can't find",
  'unable to find',
  'does not exist',
  "doesn't exist",
  'may not exist',
  'might not exist',
  'no record',
  'not sure',
  'not certain',
  "don't have information",
  'do not have information',
  "don't have any information",
  'no information',
  'not a known',
  'not a widely',
  'not widely known',
  'cannot verify',
  "can't verify",
  'unable to verify',
  // Phrasings from real gpt-6-luna answers (5 October 2026).
  "can't reliably",
  'cannot reliably',
  "can't confirm",
  'cannot confirm',
  'unable to confirm',
  "don't want to invent",
  'do not want to invent',
  "don't want to guess",
  'do not want to guess',
  "won't guess",
  'rather not guess',
]

// Words that warn that a version can be out of date, or tell you to check it.
export const WARN_WORDS = [
  ...HEDGE_WORDS,
  'as of my',
  'knowledge cutoff',
  'training data',
  'last update',
  'at the time of',
  'real-time',
  'live data',
  'may be outdated',
  'might be outdated',
  'may have changed',
  'might have changed',
  'may be newer',
  'might be newer',
  'newer version',
  'newer release',
  "can't check",
  'cannot check',
  'unable to check',
  'check npm',
  'check the npm',
  'npm view',
  'npm show',
  'npm info',
  'npmjs.com',
  'check the official',
  'to confirm',
  'to verify',
]

// An answer that asks which one you mean does not guess, even when it names
// the book as one option ("Which Alice do you mean, the one in Wonderland…?").
export const CLARIFY_WORDS = [
  'which alice',
  'which one',
  'do you mean',
  'did you mean',
  'could you clarify',
  'can you clarify',
  'could you tell me which',
  'can you tell me which',
  'more context',
  'tell me more about',
  'who do you mean',
  'what do you mean',
]

export interface KeywordCheck {
  hit: boolean
  /** The words that matched. */
  words: string[]
}

/** Case-insensitive, and curly apostrophes count as straight ones. */
export function keywordCheck(text: string, words: string[]): KeywordCheck {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'")
  const found = words.filter((w) => lower.includes(w))
  return { hit: found.length > 0, words: found }
}

/** The user message: the context (if any), then the question. */
export function prompt(context: string, question: string): string {
  return context.trim()
    ? `${context.trim()}\n\n${question.trim()}`
    : question.trim()
}

export interface AskOptions {
  question: string
  context?: string
  provider?: string
  model?: string
}

export interface Answer {
  question: string
  context: string
  text: string
  /** Simple keyword check: does the answer talk about the book character? */
  book: KeywordCheck
  /** Simple keyword check: does the answer say it does not know? */
  hedge: KeywordCheck
  /** Simple keyword check: does the answer ask which one you mean? */
  asks: KeywordCheck
  provider: string
  model: string
  ms: number
  incompleteReason: string | null
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export function requestBody(options: AskOptions): ResponseBody {
  const question = options.question.trim()
  const context = (options.context ?? '').trim()

  if (!question) {
    throw new Error('Give a question.')
  }

  if (question.length > 1000) {
    throw new Error('Keep the question under 1000 characters.')
  }

  if (context.length > 2000) {
    throw new Error('Keep the context under 2000 characters.')
  }

  return {
    model: options.model,
    instructions: INSTRUCTIONS,
    input: [userMessage(prompt(context, question))],
    reasoning: { effort: 'low' },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  }
}

/** One question, one answer, both keyword checks. */
export async function ask(options: AskOptions): Promise<Answer> {
  const body = requestBody(options)
  const provider = pickProvider(options.provider)
  const result = await createResponse(body, { provider })

  return {
    question: options.question.trim(),
    context: (options.context ?? '').trim(),
    text: result.text,
    book: keywordCheck(result.text, BOOK_WORDS),
    hedge: keywordCheck(result.text, HEDGE_WORDS),
    asks: keywordCheck(result.text, CLARIFY_WORDS),
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    incompleteReason: result.incompleteReason,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }
}

export interface RegistryCheck {
  name: string
  url: string
  /** false: the registry says 404. null: the check could not run. */
  exists: boolean | null
  status: number | null
}

const NPM_NAME = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]{1,214}$/

/** The registry URL of a package. A name that is not an npm name throws. */
export function registryUrl(name: string): string {
  if (!NPM_NAME.test(name)) {
    throw new Error(`"${name}" is not a valid npm package name.`)
  }

  return `https://registry.npmjs.org/${name.replace('/', '%2F')}`
}

/** Asks the public npm registry whether a package exists. No key needed. */
export async function registryCheck(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<RegistryCheck> {
  const url = registryUrl(name)

  try {
    const response = await fetcher(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    })

    const exists = response.status === 404 ? false : response.ok ? true : null

    return { name, url, exists, status: response.status }
  } catch {
    return { name, url, exists: null, status: null }
  }
}

export interface LatestVersion {
  name: string
  url: string
  /** The version with the `latest` tag on npm. null: the registry did not answer. */
  version: string | null
  status: number | null
}

/** Reads the current version of a package from the public npm registry. No key needed. */
export async function latestVersion(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<LatestVersion> {
  const url = `${registryUrl(name)}/latest`

  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    const body = (response.ok ? await response.json() : {}) as {
      version?: unknown
    }
    const version =
      typeof body.version === 'string' && parseVersion(body.version)
        ? body.version
        : null

    return { name, url, version, status: response.status }
  } catch {
    return { name, url, version: null, status: null }
  }
}

export interface Version {
  /** The numbers the text gives: [4], [4, 1] or [4, 1, 14]. "4.x" gives [4]. */
  parts: number[]
  /** "-beta.3", or '' for a release. */
  pre: string
  /** For display: "4.1.14", "3.4.x", "4.x". */
  text: string
}

function toVersion(numbers: (string | undefined)[], pre = ''): Version {
  const given = numbers.filter((n) => n !== undefined)

  // "3.4.x" says nothing after the x.
  const cut = given.indexOf('x')
  const parts = (cut === -1 ? given : given.slice(0, cut)).map(Number)
  const text = given.length === 1 ? `${given[0]}.x` : given.join('.')

  return { parts, pre, text: text + pre }
}

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?(-[0-9a-z.]+)?$/i.exec(
    text.trim(),
  )

  return m ? toVersion([m[1], m[2], m[3]], m[4]) : null
}

/** Negative: `a` is older. 0: the same, at the precision that `a` gives. Positive: `a` is newer. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < a.parts.length; i++) {
    const diff = a.parts[i] - (b.parts[i] ?? 0)
    if (diff) {
      return diff
    }
  }

  // 4.0.0-beta.1 comes before 4.0.0.
  return a.pre && !b.pre ? -1 : 0
}

// 4.1.14, v4.1, 3.4.x, 4.0.0-rc.1. A bare number counts only after v, @,
// "version" or the package name (v4, @4, version 4, Tailwind CSS 4), so
// "80 words" and "2025" do not.
const VERSION_IN_TEXT =
  /(\bv|@|\bversion\s+|(?<![\w.$]))(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?(-(?:alpha|beta|rc|canary|next|insiders)[\w.]*)?(?![\w.]*\d)/gi
const LATEST_TALK = /\b(latest|current|newest|stable)\b/i
// A sentence about a pre-release does not name the latest version: "v5 is in beta."
const PRERELEASE_TALK =
  /\b(alpha|beta|preview|upcoming|release candidate|in development|not yet released)\b/i

/**
 * The version that the answer gives as the latest, or null. It reads the
 * sentences that name the package or say "latest", "current", "newest" or
 * "stable", and takes the highest version in them. Simple on purpose: read the answer.
 */
export function statedVersion(text: string, name: string): Version | null {
  // The name as people write it: tailwindcss, Tailwind CSS, tailwind-css.
  const bare = name.replace(/^@[^/]+\//, '').replace(/[._-]/g, '')
  const named = new RegExp(`\\b${bare.split('').join('[\\s._-]?')}\\b`, 'i')
  const afterName = new RegExp(`${named.source}\\s*$`, 'i')

  let best: Version | null = null
  for (const sentence of text
    .replace(/[*`]/g, ' ')
    .split(/(?<=[.!?;])\s+|\n+/)) {
    if (
      PRERELEASE_TALK.test(sentence) ||
      !(named.test(sentence) || LATEST_TALK.test(sentence))
    ) {
      continue
    }

    for (const m of sentence.matchAll(VERSION_IN_TEXT)) {
      const before = sentence.slice(0, m.index)
      if (!m[1] && m[3] === undefined && !afterName.test(before)) {
        continue
      }

      // "Node.js 20.11", "npm 10.2" and "Vite 7.0" are versions of other tools.
      // "Tailwind CSS 4.1" is not: CSS is a part of the name.
      const word = /([a-z][\w.]*)\s+$/i.exec(before)?.[1]
      const otherTool =
        word &&
        !named.test(word) &&
        !bare.includes(word.toLowerCase()) &&
        (/^(node(\.js)?|npm)$/i.test(word) ||
          (/^[A-Z]/.test(word) && !LATEST_TALK.test(word)))
      if (otherTool) {
        continue
      }

      const version = toVersion([m[2], m[3], m[4]], m[5] ?? '')
      if (!best || compareVersions(version, best) > 0) {
        best = version
      }
    }
  }

  return best
}

export type VersionVerdict =
  | 'stale'
  | 'current'
  | 'ahead'
  | 'unsure'
  | 'no-version'
  | 'no-registry'

export interface VersionCheck {
  name: string
  /** The version that the answer gives as the latest, for display, or null. */
  said: string | null
  /** The current version on npm, or null when the registry did not answer. */
  current: string | null
  /** Simple keyword check: does the answer warn that it can be out of date, or say to check? */
  warns: KeywordCheck
  verdict: VersionVerdict
}

export function versionCheck(
  text: string,
  name: string,
  current: string | null,
): VersionCheck {
  const stated = statedVersion(text, name)
  const warns = keywordCheck(text, WARN_WORDS)
  const real = current ? parseVersion(current) : null
  const diff = stated && real ? compareVersions(stated, real) : 0

  const verdict: VersionVerdict = !stated
    ? warns.hit
      ? 'unsure'
      : 'no-version'
    : !real
      ? 'no-registry'
      : diff < 0
        ? 'stale'
        : diff > 0
          ? 'ahead'
          : 'current'

  return {
    name,
    said: stated?.text ?? null,
    current: real ? current : null,
    warns,
    verdict,
  }
}

/** One short line for the answer card. */
export function versionLine(c: VersionCheck): string {
  switch (c.verdict) {
    case 'stale':
      return `Stale: said ${c.said}, current is ${c.current}`
    case 'current':
      return `Current: said ${c.said}, the registry says ${c.current}`
    case 'ahead':
      return `Wrong: said ${c.said}, but the current version is ${c.current}`
    case 'unsure':
      return 'Gave no version: said it is not sure, or to check'
    case 'no-version':
      return 'No version found in the answer'
    case 'no-registry':
      return `Said ${c.said}; the registry check failed, so there is nothing to compare`
  }
}

/** One sentence for the result: what the model said, and the real version. */
export function versionSummary(c: VersionCheck): string {
  const asked = `Asked for the latest version of ${c.name}, the model`
  const real = c.current
    ? `The current version is ${c.current}.`
    : 'The npm registry did not answer, so the script cannot compare.'

  switch (c.verdict) {
    case 'stale':
      return `${asked} said ${c.said} ${c.warns.hit ? 'and warned that it can be out of date' : 'with no warning'}. ${real}`
    case 'current':
      return `${asked} said ${c.said}. That is current: the registry says ${c.current}.`
    case 'ahead':
      return `${asked} said ${c.said}, but the current version is ${c.current}.`
    case 'unsure':
      return `${asked} gave no version and said to check. ${real}`
    case 'no-version':
      return `${asked} gave no version number. Read its answer. ${real}`
    case 'no-registry':
      return `${asked} said ${c.said}. ${real}`
  }
}

export interface LatestAnswer extends Answer {
  registry: LatestVersion
  version: VersionCheck
}

/** Asks for the latest version and reads the real one from npm, at the same time. */
export async function askLatest(
  options: { name?: string; provider?: string; model?: string },
  fetcher: typeof fetch = fetch,
): Promise<LatestAnswer> {
  const name = options.name ?? LATEST_PACKAGE
  // A bad name and a missing key fail here, before any network call.
  registryUrl(name)
  pickProvider(options.provider)

  const [answer, registry] = await Promise.all([
    ask({
      question: latestQuestion(name),
      provider: options.provider,
      model: options.model,
    }),
    latestVersion(name, fetcher),
  ])

  return {
    ...answer,
    registry,
    version: versionCheck(answer.text, name, registry.version),
  }
}

export type Verdict = 'asked' | 'guessed' | 'used-context'

/** For the Alice cards: asked back, guessed the book character, or used the context. */
export function aliceVerdict(answer: Pick<Answer, 'book' | 'asks'>): Verdict {
  if (answer.asks.hit) {
    return 'asked'
  }

  return answer.book.hit ? 'guessed' : 'used-context'
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  asked: 'Asked which Alice you mean',
  guessed: 'Guessed the book character',
  'used-context': 'Used the context, no book character',
}
