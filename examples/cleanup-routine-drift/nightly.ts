// The nightly cleanup, in two modes. Each night is one structured-output
// request with the whole wiki and the same instruction. Night N works on the
// wiki that night N-1 left behind.
//
//   rewrite  the model returns whole new notes and a delete list;
//            code applies them as given
//   edits    the model returns small edit operations; code checks each one
//            against the wiki before it applies it, and skips the ones that
//            drop a fact, break a link or delete a note

import { byId } from '#shared/input.ts'
import { check, type JsonSchema } from '#shared/json-schema.ts'
import {
  createResponse,
  LlmError,
  type LlmResult,
  NO_USAGE,
  pickProvider,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { errorText } from '#shared/print.ts'
import {
  type BrokenLink,
  brokenLinks,
  factsIn,
  lostFacts,
  type Measure,
  measure,
  NOTES,
  type Wiki,
} from './wiki.ts'

export type ModeId = 'rewrite' | 'edits'

export interface Mode {
  id: ModeId
  label: string
  about: string
}

export const MODES: Mode[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    about:
      'The model returns whole new notes and may delete notes. Code saves them as given.',
  },
  {
    id: 'edits',
    label: 'Checked edits',
    about:
      'The model returns small edits. Code skips an edit that drops a fact, breaks a link or deletes a note.',
  },
]

export const MAX_NIGHTS = 5
export const EFFORTS = ['none', 'low', 'medium'] as const
export type Effort = (typeof EFFORTS)[number]

/** The mode with this id. A night needs one, so a missing id is wrong too. */
export function modeById(id: unknown): Mode {
  return byId(MODES, String(id), 'mode')
}

// The same task every night, in both modes. Only the answer format differs.
const TASK = [
  'You run the nightly cleanup of a team wiki. Nobody reviews your changes before they are saved.',
  'Tidy the wiki: merge notes that repeat each other, fix the structure, and remove clutter. Keep every piece of information.',
  'Notes link to each other as [[note-id]].',
].join('\n')

const FORMAT: Record<ModeId, string> = {
  rewrite: [
    'Answer format: "notes" holds every note you change or create, each with its full new Markdown text. Notes you do not return stay as they are.',
    '"delete" lists the ids of notes to remove. Return empty lists when nothing needs to change.',
  ].join('\n'),
  edits: [
    'Answer format: "operations" is a list of edits. Code applies them in order. Fields that an operation does not use are empty strings.',
    '- replace_text: in "note", replace the exact text "find" with "text".',
    '- append: add "text" at the end of "note".',
    '- add_link: add a line "See also [[target]]" at the end of "note".',
    '- mark_duplicate: turn "note" into a short stub that points to "target", the note that keeps the content.',
    '- delete_note: remove "note".',
    'Return an empty list when nothing needs to change.',
  ].join('\n'),
}

export const instructionsFor = (mode: ModeId) => `${TASK}\n\n${FORMAT[mode]}`

const str = { type: 'string' }

export const SCHEMAS: Record<ModeId, JsonSchema> = {
  rewrite: {
    type: 'object',
    additionalProperties: false,
    required: ['notes', 'delete'],
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'text'],
          properties: { id: str, text: str },
        },
      },
      delete: { type: 'array', items: str },
    },
  },
  edits: {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'note', 'find', 'text', 'target'],
          properties: {
            op: {
              type: 'string',
              enum: [
                'replace_text',
                'append',
                'add_link',
                'mark_duplicate',
                'delete_note',
              ],
            },
            note: str,
            find: str,
            text: str,
            target: str,
          },
        },
      },
    },
  },
}

/** The user message: every note as a file, with its id. */
export function wikiPrompt(wiki: Wiki): string {
  const files = Object.entries(wiki).map(
    ([id, text]) => `=== ${id} ===\n${text.trim()}`,
  )
  return `The wiki (${files.length} notes):\n\n${files.join('\n\n')}`
}

/** Note ids as a model may write them: "pallets.md", "[[pallets]]". */
export const noteId = (value: string) =>
  value
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/\.md$/, '')
    .trim()

// ── Mode A: apply whole notes as given ─────────────────────────────────

export interface Rewrite {
  notes: { id: string; text: string }[]
  delete: string[]
}

export function applyRewrite(wiki: Wiki, answer: Rewrite): Wiki {
  const next = { ...wiki }
  for (const note of answer.notes) {
    next[noteId(note.id)] = note.text
  }
  for (const id of answer.delete) {
    delete next[noteId(id)]
  }
  return next
}

// ── Mode B: check each operation, then apply it ────────────────────────

export interface Operation {
  op: 'replace_text' | 'append' | 'add_link' | 'mark_duplicate' | 'delete_note'
  note: string
  find: string
  text: string
  target: string
}

export interface CheckedOp extends Operation {
  accepted: boolean
  /** Why code skipped it. Empty when accepted. */
  reason: string
}

type Edited = { text: string } | { error: string }

/** The note text after one operation, or the reason it does not apply. */
function edit(wiki: Wiki, op: Operation): Edited {
  const note = noteId(op.note)
  const text = wiki[note]
  const target = noteId(op.target)

  if (op.op === 'replace_text') {
    if (!op.find) {
      return { error: 'the text to replace is empty' }
    }
    if (!text.includes(op.find)) {
      return { error: `the text to replace is not in ${note}` }
    }
    return { text: text.replace(op.find, () => op.text) }
  }

  if (op.op === 'append') {
    if (!op.text.trim()) {
      return { error: 'the text to add is empty' }
    }
    return { text: `${text.trimEnd()}\n\n${op.text.trim()}\n` }
  }

  if (op.op === 'add_link') {
    return { text: `${text.trimEnd()}\n\nSee also [[${target}]]\n` }
  }

  return markDuplicate(wiki, note, target)
}

// The stub keeps the note and its id, so links to it still lead somewhere.
function markDuplicate(wiki: Wiki, note: string, target: string): Edited {
  if (target === note) {
    return { error: 'a note cannot be a duplicate of itself' }
  }
  if (!(target in wiki)) {
    return { error: `there is no note "${target}" to keep` }
  }

  const text = wiki[note]
  const kept = factsIn(wiki[target])
  const missing = factsIn(text).filter((f) => !kept.includes(f))
  if (missing.length) {
    const values = missing.map((f) => `"${f.value}"`).join(', ')
    return { error: `${target} does not hold ${values} yet` }
  }

  const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? note

  return { text: `# ${title}\n\nMerged into [[${target}]].\n` }
}

/**
 * The rules that make an unattended edit safe. Each op is checked on the
 * wiki as the earlier ops left it.
 */
export function checkOp(
  wiki: Wiki,
  op: Operation,
): { accepted: true; wiki: Wiki } | { accepted: false; reason: string } {
  const note = noteId(op.note)
  if (op.op === 'delete_note') {
    return { accepted: false, reason: 'Deletes a note.' }
  }
  if (!(note in wiki)) {
    const reason = `Does not apply: there is no note "${note}".`
    return { accepted: false, reason }
  }

  const result = edit(wiki, op)
  if ('error' in result) {
    return { accepted: false, reason: `Does not apply: ${result.error}.` }
  }

  const next = { ...wiki, [note]: result.text }
  const before = lostFacts(wiki)
  const dropped = lostFacts(next).filter((f) => !before.includes(f))
  if (dropped.length) {
    const values = dropped.map((f) => `"${f.value}"`).join(', ')
    return { accepted: false, reason: `Drops a fact: ${values}.` }
  }

  const link = (b: BrokenLink) => `${b.note}>${b.target}`
  const was = new Set(brokenLinks(wiki).map(link))
  const broken = brokenLinks(next).filter((b) => !was.has(link(b)))
  if (broken.length) {
    const links = broken.map((b) => `${b.note} → [[${b.target}]]`).join(', ')
    return { accepted: false, reason: `Breaks a link: ${links}.` }
  }

  return { accepted: true, wiki: next }
}

export function applyOps(
  wiki: Wiki,
  ops: Operation[],
): { wiki: Wiki; ops: CheckedOp[] } {
  let current = wiki
  const checked = ops.map((op): CheckedOp => {
    const verdict = checkOp(current, op)
    if (!verdict.accepted) {
      return { ...op, accepted: false, reason: verdict.reason }
    }
    current = verdict.wiki
    return { ...op, accepted: true, reason: '' }
  })

  return { wiki: current, ops: checked }
}

// ── One night ──────────────────────────────────────────────────────────

export interface NoteChange {
  id: string
  kind: 'changed' | 'created' | 'deleted'
  before: string
  after: string
}

export interface Night {
  mode: ModeId
  night: number
  wiki: Wiki
  after: Measure
  /** Facts that were in the wiki before this night and are gone after it. */
  lost: { id: string; value: string; note: string; label: string }[]
  deleted: string[]
  changes: NoteChange[]
  /** Mode B only: every operation, with the verdict. */
  ops: CheckedOp[]
  rejected: number
  /**
   * Set when the night failed: nothing was saved, and the next night works on
   * the same wiki.
   */
  error: string | null
  provider: string
  model: string
  ms: number
  usage: Usage
  request: LlmResult['request']
  response: unknown
}

export function changesOf(before: Wiki, after: Wiki): NoteChange[] {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])]

  return ids.flatMap((id): NoteChange[] => {
    if (!(id in after)) {
      return [{ id, kind: 'deleted', before: before[id], after: '' }]
    }
    if (!(id in before)) {
      return [{ id, kind: 'created', before: '', after: after[id] }]
    }
    if (before[id] === after[id]) {
      return []
    }
    return [{ id, kind: 'changed', before: before[id], after: after[id] }]
  })
}

export type Answer = Rewrite | { operations: Operation[] }

/** Reads the model's answer: JSON that matches the mode's schema. */
export function parseAnswer(mode: ModeId, text: string): Answer {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('The model did not answer with JSON.')
  }

  const result = check(SCHEMAS[mode], value)
  if (!result.ok) {
    const errors = result.errors.slice(0, 3).join('; ')
    throw new Error(`The answer does not match the schema: ${errors}`)
  }

  // The schema check above makes this cast safe.
  return value as Answer
}

export interface NightOptions {
  mode: ModeId
  wiki: Wiki
  night: number
  effort?: Effort
  provider?: string
  model?: string
}

// A cap well above a normal answer (about 1,000 tokens here). A model that
// starts to repeat itself stops here instead of running for minutes.
const MAX_OUTPUT_TOKENS = 6_000

export async function runNight(options: NightOptions): Promise<Night> {
  const { mode, wiki, night } = options
  const unchanged = {
    mode,
    night,
    wiki,
    after: measure(wiki),
    lost: [],
    deleted: [],
    changes: [],
    ops: [],
    rejected: 0,
  }

  let result: LlmResult
  try {
    result = await askForCleanup(options)
  } catch (error) {
    if (!(error instanceof LlmError)) {
      throw error
    }
    return { ...unchanged, ...requestFailed(error) }
  }

  const shown = {
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    usage: result.usage,
    request: result.request,
    response: result.response,
  }

  let answer: Answer
  try {
    answer = readAnswer(mode, result)
  } catch (error) {
    return { ...unchanged, error: errorText(error), ...shown }
  }

  return { mode, night, ...applyAnswer(wiki, answer), error: null, ...shown }
}

/** One structured-output request with the whole wiki. */
function askForCleanup(options: NightOptions): Promise<LlmResult> {
  const { mode } = options
  const provider = pickProvider(options.provider)

  return createResponse(
    {
      model: options.model,
      instructions: instructionsFor(mode),
      input: [userMessage(wikiPrompt(options.wiki))],
      text: {
        format: {
          type: 'json_schema',
          name: mode === 'rewrite' ? 'cleanup_rewrite' : 'cleanup_edits',
          strict: true,
          schema: SCHEMAS[mode],
        },
      },
      reasoning: { effort: options.effort ?? 'none' },
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    { provider },
  )
}

/** The fields of a night whose request got no answer. */
function requestFailed(error: LlmError) {
  return {
    error: error.message.replace(/\.?$/, '.'),
    provider: error.provider,
    model: error.request.body.model,
    ms: 0,
    // No answer, so no usage either: the cost of this request is unknown.
    usage: { ...NO_USAGE, cost: null },
    request: error.request,
    response: error.response,
  }
}

/** The answer of a request. Throws when it was cut or does not match. */
function readAnswer(mode: ModeId, result: LlmResult): Answer {
  if (result.incompleteReason === 'max_output_tokens') {
    const limit = `the limit of ${MAX_OUTPUT_TOKENS} output tokens`
    throw new Error(`The answer was cut at ${limit}.`)
  }
  if (result.incompleteReason) {
    throw new Error(`The answer was cut (${result.incompleteReason}).`)
  }

  return parseAnswer(mode, result.text)
}

/** The wiki after the answer, and what the night changed in it. */
function applyAnswer(wiki: Wiki, answer: Answer) {
  const { wiki: next, ops } = nextWiki(wiki, answer)
  const was = new Set(lostFacts(wiki).map((f) => f.id))
  const changes = changesOf(wiki, next)

  return {
    wiki: next,
    after: measure(next),
    lost: lostFacts(next).filter((f) => !was.has(f.id)),
    deleted: changes.filter((c) => c.kind === 'deleted').map((c) => c.id),
    changes,
    ops,
    rejected: ops.filter((o) => !o.accepted).length,
  }
}

function nextWiki(
  wiki: Wiki,
  answer: Answer,
): { wiki: Wiki; ops: CheckedOp[] } {
  // The two schemas share no field, so "operations" tells the modes apart.
  if ('operations' in answer) {
    return applyOps(wiki, answer.operations)
  }

  return { wiki: applyRewrite(wiki, answer), ops: [] }
}

// ── Several nights, both modes ─────────────────────────────────────────

export interface Drift {
  mode: Mode
  nights: Night[]
}

/** One mode, night after night, each on the wiki the night before left. */
export async function runMode(options: {
  mode: ModeId
  nights: number
  effort?: Effort
  provider?: string
  model?: string
  onNight?: (night: Night) => void
}): Promise<Drift> {
  const nights: Night[] = []
  let wiki = NOTES
  for (let n = 1; n <= options.nights; n++) {
    const night = await runNight({ ...options, wiki, night: n })
    nights.push(night)
    options.onNight?.(night)
    wiki = night.wiki
  }

  return { mode: modeById(options.mode), nights }
}

/**
 * Both modes side by side. The modes run at the same time; the nights of one
 * mode run in order.
 */
export async function runDrift(
  options: {
    modes?: ModeId[]
    nights?: number
    effort?: Effort
    provider?: string
    model?: string
    onNight?: (night: Night) => void
  } = {},
): Promise<Drift[]> {
  const nights = options.nights ?? MAX_NIGHTS
  // Check the key once, before any request.
  const provider = pickProvider(options.provider)
  const modes = options.modes ?? MODES.map((m) => m.id)

  return Promise.all(
    modes.map((mode) => runMode({ ...options, mode, nights, provider })),
  )
}

export const START = measure(NOTES)
