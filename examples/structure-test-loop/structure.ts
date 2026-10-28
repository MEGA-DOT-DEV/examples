// A structure is what the designer returns: a path for every raw item, a
// map.md and one template. Code checks it before any test runs, and scores
// the tester's answers against it.
import { check, type JsonSchema } from '#shared/json-schema.ts'
import { ITEM_IDS, TASKS, type Task } from './items.ts'

export interface Structure {
  files: { id: string; path: string }[]
  map: string
  template: string
  /** Only in the self-rated mode. */
  self_rating?: SelfRating
}

export interface SelfRating {
  /** How many of the 10 tasks the designer expects the tester to get right. */
  expected: number
  ready: boolean
  reason: string
}

export const MAX_MAP = 2_000
export const MAX_TEMPLATE = 1_200
export const MAX_DEPTH = 4

/** The structured output schema. The self-rated mode adds `self_rating`. */
export function structureSchema(selfRating: boolean): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'path'],
        properties: {
          id: { type: 'string', enum: ITEM_IDS },
          path: { type: 'string' },
        },
      },
    },
    map: { type: 'string' },
    template: { type: 'string' },
  }

  if (selfRating) {
    properties.self_rating = {
      type: 'object',
      additionalProperties: false,
      required: ['expected', 'ready', 'reason'],
      properties: {
        expected: { type: 'integer' },
        ready: { type: 'boolean' },
        reason: { type: 'string' },
      },
    }
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  }
}

// Lower case, `-`, `_` and `.` inside a name, at least one folder, `.md` at
// the end. A name must start with a letter or digit, so `..` and hidden files
// never pass.
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/

/** Why a path is unsafe, or null when it is a safe relative path. */
export function pathProblem(path: string): string | null {
  const parts = path.split('/')
  if (!path.endsWith('.md')) {
    return 'does not end with .md'
  }
  if (parts.length < 2) {
    return 'is not in a folder'
  }
  if (parts.length > MAX_DEPTH) {
    return `has more than ${MAX_DEPTH} parts, counting the file name`
  }
  if (!parts.every((p) => SEGMENT.test(p))) {
    return 'is not a safe relative path (lower case, digits, - _ . only, no leading / or ..)'
  }

  return null
}

export interface StructureCheck {
  ok: boolean
  errors: string[]
  structure: Structure | null
}

/**
 * Parses the designer's text and checks it: the schema, then the rules code
 * adds.
 */
export function checkStructure(
  text: string,
  selfRating = false,
): StructureCheck {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {
      ok: false,
      errors: ['The output is not valid JSON.'],
      structure: null,
    }
  }

  const schema = check(structureSchema(selfRating), value)
  if (!schema.ok) {
    return { ok: false, errors: schema.errors, structure: null }
  }

  // The schema check passed, so the value has the shape of a Structure.
  const structure = value as Structure
  const errors = [
    ...itemErrors(structure),
    ...pathErrors(structure),
    ...sizeErrors(structure),
  ]

  return { ok: errors.length === 0, errors, structure }
}

/** Every item exactly once. */
function itemErrors(structure: Structure): string[] {
  const errors: string[] = []
  const count = new Map<string, number>()
  for (const f of structure.files) {
    count.set(f.id, (count.get(f.id) ?? 0) + 1)
  }

  const missing = ITEM_IDS.filter((id) => !count.has(id))
  if (missing.length) {
    errors.push(`Missing items: ${missing.join(', ')}.`)
  }
  const twice = [...count.keys()].filter((id) => (count.get(id) ?? 0) > 1)
  if (twice.length) {
    errors.push(`Items with more than one path: ${twice.join(', ')}.`)
  }
  const unknown = [...count.keys()].filter((id) => !ITEM_IDS.includes(id))
  if (unknown.length) {
    errors.push(`Unknown items: ${unknown.join(', ')}.`)
  }

  return errors
}

/** Safe, distinct paths. */
function pathErrors(structure: Structure): string[] {
  const errors: string[] = []
  for (const f of structure.files) {
    const problem = pathProblem(f.path)
    if (problem) {
      errors.push(`${f.id}: "${f.path}" ${problem}.`)
    }
  }

  const seen = new Map<string, string>()
  for (const f of structure.files) {
    const other = seen.get(f.path)
    if (other && other !== f.id) {
      errors.push(`${other} and ${f.id} share the path "${f.path}".`)
    }
    seen.set(f.path, f.id)
  }

  return errors
}

/**
 * map.md and the template: not empty, within their limits. The self-rating
 * within the task count.
 */
function sizeErrors(structure: Structure): string[] {
  const { map, template, self_rating: rating } = structure
  const errors: string[] = []
  if (!map.trim()) {
    errors.push('map.md is empty.')
  }
  if (map.length > MAX_MAP) {
    errors.push(`map.md has ${map.length} characters; the limit is ${MAX_MAP}.`)
  }
  if (!template.trim()) {
    errors.push('The template is empty.')
  }
  if (template.length > MAX_TEMPLATE) {
    errors.push(
      `The template has ${template.length} characters; the limit is ${MAX_TEMPLATE}.`,
    )
  }
  if (rating && (rating.expected < 0 || rating.expected > TASKS.length)) {
    errors.push(`The self-rating must be from 0 to ${TASKS.length}.`)
  }

  return errors
}

export const pathsOf = (s: Structure) => s.files.map((f) => f.path).sort()
export const pathOf = (s: Structure, id: string) =>
  s.files.find((f) => f.id === id)?.path ?? ''
export const folderOf = (path: string) =>
  path.slice(0, path.lastIndexOf('/') + 1)

/** What the tester sees: map.md and the tree of paths. Never the item text. */
export function testerView(s: Structure): string {
  return `# map.md\n\n${s.map.trim()}\n\n# Files\n\n${['map.md', ...pathsOf(s)].join('\n')}`
}

export interface Answer {
  task: string
  path: string
}

export interface TaskResult {
  task: Task
  answer: string
  /** lookup: the item's path. file: the twin's folder. */
  right: string
  hit: boolean
  /** Why a miss is a miss, in a few words. */
  why: string
}

/** Scores the tester's answers against the paths of this structure. */
export function scoreAnswers(s: Structure, answers: Answer[]): TaskResult[] {
  const existing = new Set(pathsOf(s))

  return TASKS.map((task) => {
    // The tester writes paths: trim, lower case, drop a leading ./ or /.
    const answer = (answers.find((a) => a.task === task.id)?.path ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\.?\//, '')
    const twin = pathOf(s, task.item)
    if (task.kind === 'lookup') {
      const hit = answer === twin
      const miss = answer ? 'another path' : 'no answer'
      return { task, answer, right: twin, hit, why: hit ? '' : miss }
    }

    // Filing: a new file, next to the twin.
    const right = folderOf(twin)
    const why = filingMiss(answer, right, existing)

    return { task, answer, right, hit: !why, why }
  })
}

/**
 * Why a filing answer misses, or '' when it is a new file in the right folder.
 */
function filingMiss(answer: string, right: string, existing: Set<string>) {
  if (!answer) {
    return 'no answer'
  }
  if (existing.has(answer)) {
    return 'an existing note: filing would overwrite it'
  }
  if (pathProblem(answer)) {
    return 'not a safe path'
  }

  return folderOf(answer) === right ? '' : 'another folder'
}

export const TESTER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'path'],
        properties: {
          task: { type: 'string', enum: TASKS.map((t) => t.id) },
          path: { type: 'string' },
        },
      },
    },
  },
}
