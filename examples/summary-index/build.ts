// The build step: the model reads the notes, 10 at a time, and writes one
// line per note. The lines become index.md, which the index mode puts in
// the agent's instructions. This runs once per run of the example and its
// cost is shown apart from the questions: it is paid once, not per question.
import { check } from '#shared/json-schema.ts'
import {
  createResponse,
  type LlmResult,
  pickProvider,
  sumUsage,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import type { ProviderId } from '#shared/providers.ts'
import { countTokens, NOTES, type Note } from './notes.ts'

export const BATCH_SIZE = 10

const INSTRUCTIONS = `You write the index of a personal knowledge base: one line for each note you get. An assistant reads only the index to decide which note to open, so a line must say what the note is about in the plain, everyday words a person would use to ask about it later, not only the words the note itself uses.
Rules for each line: one sentence, at most 18 words. No exact values: no passwords, prices, dates, codes or numbers. The assistant opens the note for those.`

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, summary: { type: 'string' } },
        required: ['path', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
}

export interface IndexLine {
  path: string
  summary: string
}

export interface BuildRequest {
  notes: string[]
  usage: Usage
  request: unknown
  response: unknown
}

export interface BuiltIndex {
  provider: ProviderId
  model: string
  /** index.md, as the index mode puts it in the instructions. */
  text: string
  lines: IndexLine[]
  /** Tokens of index.md (o200k_base), and per note. */
  tokens: number
  tokensPerNote: number
  requests: BuildRequest[]
  usage: Usage
  ms: number
}

/** index.md: a heading, one sentence, then one line per note. */
export function indexText(lines: IndexLine[]): string {
  return [
    '# Index of the notes',
    '',
    'One line per note: the file name, then what the note is about.',
    '',
    ...lines.map((line) => `- ${line.path}: ${line.summary}`),
  ].join('\n')
}

/** One request: the model summarizes one batch of notes. */
async function summarize(batch: Note[], provider: ProviderId, model?: string) {
  const notes = batch
    .map((note) => `<note path="${note.path}">\n${note.text}\n</note>`)
    .join('\n\n')
  const result = await createResponse(
    {
      model,
      instructions: INSTRUCTIONS,
      input: [userMessage(notes)],
      reasoning: { effort: 'low' },
      max_output_tokens: 3_000,
      text: {
        format: {
          type: 'json_schema',
          name: 'index_lines',
          schema: SCHEMA,
          strict: true,
        },
      },
    },
    { provider },
  )

  return {
    lines: readLines(result, batch),
    request: {
      notes: batch.map((note) => note.path),
      usage: result.usage,
      request: result.request,
      response: result.response,
    },
    model: result.model,
  }
}

/** One index line per note of the batch. Throws when a note gets no line. */
function readLines(result: LlmResult, batch: Note[]): IndexLine[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    const first = batch[0].path
    const last = batch[batch.length - 1].path
    throw new Error(
      `The index reply for ${first} to ${last} is not JSON (status ${result.status}).`,
    )
  }

  const checked = check(SCHEMA, parsed)
  if (!checked.ok) {
    throw new Error(
      `The index reply does not match the schema: ${checked.errors[0]}`,
    )
  }

  // check() above proved this shape.
  const reply = parsed as { lines: IndexLine[] }
  const byPath = new Map(
    reply.lines.map((line) => [
      line.path.trim(),
      line.summary.trim().replace(/\s+/g, ' '),
    ]),
  )
  const lines = batch.map((note) => ({
    path: note.path,
    summary: byPath.get(note.path) ?? '',
  }))

  const missing = lines.filter((line) => !line.summary)
  if (missing.length) {
    const paths = missing.map((line) => line.path).join(', ')
    throw new Error(
      `The model wrote no index line for ${paths}. Run the build again.`,
    )
  }

  return lines
}

/** Builds index.md from every note: one request per batch of 10, all at the same time. */
export async function buildIndex(
  options: { provider?: string; model?: string; notes?: Note[] } = {},
): Promise<BuiltIndex> {
  const provider = pickProvider(options.provider)
  const notes = options.notes ?? NOTES
  const batches = Array.from(
    { length: Math.ceil(notes.length / BATCH_SIZE) },
    (_, i) => notes.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  )

  const started = performance.now()
  const done = await Promise.all(
    batches.map((batch) => summarize(batch, provider, options.model)),
  )

  const lines = done.flatMap((batch) => batch.lines)
  const text = indexText(lines)
  const tokens = countTokens(text)

  return {
    provider,
    model: done[0].model,
    text,
    lines,
    tokens,
    tokensPerNote: tokens / lines.length,
    requests: done.map((batch) => batch.request),
    usage: sumUsage(done.map((batch) => batch.request.usage)),
    ms: Math.round(performance.now() - started),
  }
}
