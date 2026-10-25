// Compacts a coding thread into a summary, round after round, as a harness
// does in a long session, and checks in code which facts survive.
// Shared by the CLI (index.ts) and the browser page (api.ts).
import { readFileSync } from 'node:fs'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import {
  assistantMessage,
  createResponse,
  type InputItem,
  type LlmResult,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'

export interface Message {
  role: 'user' | 'assistant'
  text: string
}

export interface Fact {
  id: string
  label: string
  /** Asked after each round. It must not give the answer away. */
  question: string
  /** Regular expressions (case-insensitive). One match in the answer = kept. */
  match: string[]
  /** The round whose messages first hold the fact. */
  round: number
}

export interface Thread {
  title: string
  /** segments[0] is compacted in round 1; segments[1] is added before round 2, and so on. */
  segments: Message[][]
  facts: Fact[]
}

export const ROUNDS = 3
export const DEFAULT_WORDS = 100
export const WORD_CHOICES = [50, 100, 200, 400]
export const MIN_WORDS = 20
export const MAX_WORDS = 1000
export const MAX_PROMPT = 6000
export const MAX_SUMMARY = 20_000

// Read on each call, so an edit to the thread or the prompt shows at once.
export function loadThread(): Thread {
  return JSON.parse(
    readFileSync(new URL('thread.json', import.meta.url), 'utf8'),
  ) as Thread
}

/** The compaction prompt from compact.md. {{words}} is the word budget. */
export function loadPrompt(): string {
  return readFileSync(new URL('compact.md', import.meta.url), 'utf8').trim()
}

/** Tokens in a text, with o200k_base (GPT-4o and later), counted locally. */
export function countTokens(text: string): number {
  return encode(text).length
}

/** The messages as plain text, to count their tokens. */
export function transcript(messages: Message[]): string {
  return messages.map((m) => `${m.role}: ${m.text}`).join('\n\n')
}

// After compaction, the summary is all that is left of the older messages.
const SUMMARY_PREFIX =
  'This session continues from an earlier conversation. Summary of it:\n\n'
const summaryMessage = (summary: string): Message => ({
  role: 'user',
  text: SUMMARY_PREFIX + summary,
})

const toInput = (messages: Message[]): InputItem[] =>
  messages.map((m) =>
    m.role === 'assistant' ? assistantMessage(m.text) : userMessage(m.text),
  )

/** What round `round` compacts: the thread, or the last summary plus the new messages. */
export function compactionContext(
  thread: Thread,
  round: number,
  previousSummary = '',
): Message[] {
  const added = thread.segments[round - 1] ?? []
  return round === 1 ? added : [summaryMessage(previousSummary), ...added]
}

/** The facts that the messages up to this round hold. Round 0 is the full thread. */
export function factsFor(thread: Thread, round: number): Fact[] {
  return round === 0
    ? thread.facts
    : thread.facts.filter((f) => f.round <= round)
}

export interface Step {
  round: number
  provider: ProviderId
  model: string
  ms: number
  status: string
  incompleteReason: string | null
  usage: Usage
  request: unknown
  response: unknown
}

const step = (round: number, r: LlmResult): Step => ({
  round,
  provider: r.provider,
  model: r.model,
  ms: r.ms,
  status: r.status,
  incompleteReason: r.incompleteReason,
  usage: r.usage,
  request: r.request,
  response: r.response,
})

function checkRound(round: unknown, min: number): number {
  if (
    typeof round !== 'number' ||
    !Number.isInteger(round) ||
    round < min ||
    round > ROUNDS
  ) {
    throw new Error(`Round must be a whole number from ${min} to ${ROUNDS}.`)
  }

  return round
}

function checkSummary(summary: unknown): string {
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error('Give the summary of the previous round.')
  }
  if (summary.length > MAX_SUMMARY) {
    throw new Error(`Keep the summary under ${MAX_SUMMARY} characters.`)
  }

  return summary.trim()
}

export interface CompactOptions {
  round: number
  /** The summary from the round before. Needed from round 2 on. */
  previousSummary?: string
  /** The compaction prompt. Default: compact.md. */
  prompt?: string
  /** The word budget for the summary. */
  words?: number
  provider?: string
  model?: string
}

export interface CompactResult extends Step {
  summary: string
  /** Messages from the thread that this round added. */
  added: number
  /** Tokens of the context that this round compacted. */
  contextTokens: number
  summaryTokens: number
}

/** One compaction: the context goes in, a summary comes out. */
export async function compact(options: CompactOptions): Promise<CompactResult> {
  const round = checkRound(options.round, 1)
  const previous = round > 1 ? checkSummary(options.previousSummary) : ''

  const prompt = (options.prompt ?? loadPrompt()).trim()
  if (!prompt) {
    throw new Error('The compaction prompt is empty.')
  }
  if (prompt.length > MAX_PROMPT) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT} characters.`)
  }

  const words = options.words ?? DEFAULT_WORDS
  if (!Number.isInteger(words) || words < MIN_WORDS || words > MAX_WORDS) {
    throw new Error(
      `Words must be a whole number from ${MIN_WORDS} to ${MAX_WORDS}.`,
    )
  }

  const thread = loadThread()
  const context = compactionContext(thread, round, previous)

  // As in a harness: the conversation, then one more message that asks for the summary.
  const result = await createResponse(
    {
      model: options.model,
      input: [
        ...toInput(context),
        userMessage(prompt.replaceAll('{{words}}', String(words))),
      ],
      reasoning: { effort: 'low' },
      max_output_tokens: 4000,
    },
    { provider: options.provider },
  )

  const summary = result.text.trim()
  if (!summary) {
    throw new Error(
      `${result.model} returned no summary (status: ${result.incompleteReason ?? result.status}).`,
    )
  }

  return {
    ...step(round, result),
    summary,
    added: thread.segments[round - 1].length,
    contextTokens: countTokens(transcript(context)),
    summaryTokens: countTokens(summary),
  }
}

export const PROBE_INSTRUCTIONS =
  'Answer from the conversation context only. Do not guess. When the context does not give the answer, write: unknown. ' +
  'Reply with one line per question, in the form "<number>. <answer>", and nothing else.'

export interface Answer {
  id: string
  label: string
  question: string
  answer: string
  kept: boolean
}

export interface ProbeResult extends Step {
  answers: Answer[]
  /** Tokens of the context that the questions were asked against. */
  contextTokens: number
}

/** Reads "1. answer" lines into a list, one entry per question. */
export function parseAnswers(text: string, count: number): string[] {
  const answers: string[] = Array(count).fill('')
  for (const line of text.split('\n')) {
    const hit = /^\s*[*_]*(\d+)[*_]*\s*[.):]\s*(.*)$/.exec(line)
    const n = hit ? Number(hit[1]) : 0
    if (n >= 1 && n <= count && !answers[n - 1]) {
      answers[n - 1] = hit![2].replace(/^[*_]+|[*_]+$/g, '').trim()
    }
  }

  return answers
}

/** The check is code, not a model: the exact fact is in the answer, or not. */
export function isKept(fact: Fact, answer: string): boolean {
  return fact.match.some((pattern) => new RegExp(pattern, 'i').test(answer))
}

export interface ProbeOptions {
  /** 0: the full thread, as a control. 1 to 3: the summary of that round. */
  round: number
  summary?: string
  provider?: string
  model?: string
}

/** Asks the fact questions against the full thread (round 0) or a summary. */
export async function probe(options: ProbeOptions): Promise<ProbeResult> {
  const round = checkRound(options.round, 0)
  const thread = loadThread()

  // Only the compacted context: the summary, nothing from the thread.
  const context =
    round === 0
      ? thread.segments.flat()
      : [summaryMessage(checkSummary(options.summary))]

  const facts = factsFor(thread, round)
  const questions = facts.map((f, i) => `${i + 1}. ${f.question}`).join('\n')

  const result = await createResponse(
    {
      model: options.model,
      instructions: PROBE_INSTRUCTIONS,
      input: [
        ...toInput(context),
        userMessage(`Answer these questions:\n${questions}`),
      ],
      reasoning: { effort: 'low' },
      max_output_tokens: 2000,
    },
    { provider: options.provider },
  )

  const answers = parseAnswers(result.text, facts.length)

  return {
    ...step(round, result),
    answers: facts.map((f, i) => ({
      id: f.id,
      label: f.label,
      question: f.question,
      answer: answers[i],
      kept: isKept(f, answers[i]),
    })),
    contextTokens: countTokens(transcript(context)),
  }
}

export interface ThreadInfo {
  title: string
  /** The messages that each round adds, with their token count. */
  segments: { round: number; messages: Message[]; tokens: number }[]
  fullTokens: number
  messages: number
  facts: Fact[]
  prompt: string
  words: { default: number; choices: number[]; min: number; max: number }
  rounds: number
}

/** The thread, its token counts and the defaults, for the page and the CLI. */
export function threadInfo(): ThreadInfo {
  const thread = loadThread()

  return {
    title: thread.title,
    segments: thread.segments.map((messages, i) => ({
      round: i + 1,
      messages,
      tokens: countTokens(transcript(messages)),
    })),
    fullTokens: countTokens(transcript(thread.segments.flat())),
    messages: thread.segments.flat().length,
    facts: thread.facts,
    prompt: loadPrompt(),
    words: {
      default: DEFAULT_WORDS,
      choices: WORD_CHOICES,
      min: MIN_WORDS,
      max: MAX_WORDS,
    },
    rounds: ROUNDS,
  }
}
