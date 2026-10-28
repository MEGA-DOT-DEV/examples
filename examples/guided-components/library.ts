// The guidance: three components, each with a props schema and a line on
// when to use it, and one template for an explainer note. Guided mode puts
// all of it in the instructions. Free mode gets none of it.
import { check, type JsonSchema } from '#shared/json-schema.ts'
import type { Parsed } from './svx.ts'

export type ContentKind = 'steps' | 'history' | 'decision'

export interface Component {
  name: string
  kind: ContentKind
  useFor: string
  schema: JsonSchema
  /** Props for a preview on the page. */
  sample: Record<string, unknown>
}

const text = { type: 'string' }
const list = (
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema => ({
  type: 'array',
  items: { type: 'object', properties, required, additionalProperties: false },
})

export const LIBRARY: Component[] = [
  {
    name: 'Checklist',
    kind: 'steps',
    useFor:
      'Steps a reader follows in order: a procedure, a setup, a runbook. The reader can tick each step.',
    schema: {
      type: 'object',
      properties: {
        title: text,
        items: list({ label: text, detail: text }, ['label']),
      },
      required: ['items'],
      additionalProperties: false,
    },
    sample: {
      title: 'Ship a release',
      items: [
        { label: 'Build' },
        { label: 'Run tests', detail: 'npm test' },
        { label: 'Deploy' },
        { label: 'Verify' },
      ],
    },
  },
  {
    name: 'Timeline',
    kind: 'history',
    useFor:
      'What happened when: a history, an incident, a migration over time. Oldest first.',
    schema: {
      type: 'object',
      properties: {
        title: text,
        events: list({ date: text, label: text, detail: text }, [
          'date',
          'label',
        ]),
      },
      required: ['events'],
      additionalProperties: false,
    },
    sample: {
      events: [
        { date: '2023', label: 'One server' },
        {
          date: '2024',
          label: 'Two regions',
          detail: 'After the March outage',
        },
        { date: '2025', label: 'Read replicas' },
      ],
    },
  },
  {
    name: 'Decision',
    kind: 'decision',
    useFor:
      'A choice between options: what was considered, the trade-offs of each, what was chosen and why.',
    schema: {
      type: 'object',
      properties: {
        question: text,
        options: list(
          {
            name: text,
            pros: { type: 'array', items: text },
            cons: { type: 'array', items: text },
          },
          ['name'],
        ),
        chosen: text,
        reason: text,
      },
      required: ['question', 'options', 'chosen'],
      additionalProperties: false,
    },
    sample: {
      question: 'Where do we keep feature flags?',
      options: [
        {
          name: 'Config file',
          pros: ['No new service'],
          cons: ['A deploy per change'],
        },
        {
          name: 'Flag service',
          pros: ['Change at runtime'],
          cons: ['One more vendor'],
        },
      ],
      chosen: 'Config file',
      reason: 'We change flags twice a month.',
    },
  },
]

export const TEMPLATE = `---
title: [a short title]
kind: [steps, history or decision]
---

# [The title]

[One or two sentences: what this note explains and who needs it.]

[The one library component that fits the content.]

## Details

[Everything else the reader needs, in Markdown: facts, numbers, names, links.]`

/** The library as the guided instructions show it: name, when to use it, props schema. */
export const LIBRARY_TEXT = LIBRARY.map((component) => {
  const { name, useFor, schema } = component

  return `### ${name}\nUse for: ${useFor}\nProps (JSON Schema):\n${JSON.stringify(schema)}`
}).join('\n\n')

export interface TagCheck {
  name: string
  line: number
  known: boolean
  /** Problems from check() against the props schema. Empty for an unknown component: it has no schema. */
  errors: string[]
  /** The component with its prop names, sorted: `Timeline(events, title)`. Two notes with the same shape fit one renderer. */
  shape: string
}

export interface NoteCheck {
  parsed: boolean
  parseError: string | null
  /** Component names in the order they appear, each once. */
  components: string[]
  unknown: string[]
  tags: TagCheck[]
  knownTags: number
  validTags: number
  /** Whether the note uses the library component for the topic's kind of content. */
  expectedUsed: boolean
}

/** Checks a parsed note: only known components, and props that pass check() on their schema. */
export function checkNote(parsed: Parsed, kind: ContentKind): NoteCheck {
  if (!parsed.ok) {
    return {
      parsed: false,
      parseError: parsed.error,
      components: [],
      unknown: [],
      tags: [],
      knownTags: 0,
      validTags: 0,
      expectedUsed: false,
    }
  }

  const tags = parsed.blocks.flatMap((block) =>
    block.type === 'component' ? [checkTag(block)] : [],
  )
  const components = [...new Set(tags.map((t) => t.name))]
  const known = tags.filter((t) => t.known)

  return {
    parsed: true,
    parseError: null,
    components,
    unknown: components.filter((name) => !LIBRARY.some((c) => c.name === name)),
    tags,
    knownTags: known.length,
    validTags: known.filter((t) => !t.errors.length).length,
    expectedUsed: LIBRARY.some(
      (c) => c.kind === kind && components.includes(c.name),
    ),
  }
}

function checkTag(tag: {
  name: string
  line: number
  props: Record<string, unknown>
}): TagCheck {
  const component = LIBRARY.find((c) => c.name === tag.name)
  const shape = `${tag.name}(${Object.keys(tag.props).sort().join(', ')})`

  return {
    name: tag.name,
    line: tag.line,
    known: Boolean(component),
    errors: component ? check(component.schema, tag.props).errors : [],
    shape,
  }
}
