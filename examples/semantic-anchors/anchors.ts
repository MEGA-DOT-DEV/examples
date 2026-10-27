// A known name is a semantic anchor: "Use Gherkin." points the model to a
// whole standard that it learned in training. This file sends one task with
// no guidance, with the format's rules spelled out, and with its name only,
// then checks the shape of each answer in code.
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base'
import {
  createResponse,
  pickProvider,
  type ShownRequest,
  type Usage,
  userMessage,
} from '#shared/llm.ts'
import { plural } from '#shared/print.ts'

export type Mode = 'none' | 'spelled' | 'name'
export const MODES: Mode[] = ['none', 'spelled', 'name']
export const MODE_LABELS: Record<Mode, string> = {
  none: 'No guidance',
  spelled: 'Rules spelled out',
  name: 'Format name only',
}

/** Every request starts its instructions with this. The guidance of the mode follows it. */
export const BASE_INSTRUCTIONS = 'Complete the user task.'

export interface Format {
  name: string
  task: string
  /** One sentence that describes the format: the guidance of "Rules spelled out". */
  spelled: string
  /** The check, one line each. An answer passes when it meets every rule. */
  rules: { label: string; test: (text: string) => boolean }[]
  /** Parts of the standard that the spelled-out sentence does not ask for. Each pattern is global. */
  extras: { pattern: RegExp; text: (found: string[]) => string }[]
}

const starts = (pattern: RegExp) => (text: string) => pattern.test(text.trim())
const has = (pattern: RegExp) => (text: string) => pattern.test(text)

// Each heading with the spellings models use: "Won’t", "Won't", "Wont" and "Will not".
const MOSCOW = [
  { heading: 'Must have', pattern: /must have/i },
  { heading: 'Should have', pattern: /should have/i },
  { heading: 'Could have', pattern: /could have/i },
  { heading: 'Won’t have', pattern: /(?:won[’']?t|will not) have/i },
]

export const FORMATS: Format[] = [
  {
    name: 'Conventional Commits',
    task: 'Write a commit message for adding an export button to the reports page.',
    spelled:
      'Start with a lowercase type such as feat or fix, then an optional scope in parentheses, then a colon and a space, followed by an imperative summary.',
    rules: [
      {
        label: 'Starts with a lowercase type, such as feat or fix',
        test: starts(/^(feat|fix|docs|refactor|test|chore)\b/),
      },
      {
        label: 'Then an optional scope, a colon and a space',
        test: starts(/^[a-z]+(\([a-z][\w-]*\))?!?: /),
      },
      {
        label: 'Then a summary',
        test: starts(/^[a-z]+(\([a-z][\w-]*\))?!?: [A-Z\da-z][^\n]+/),
      },
    ],
    extras: [
      {
        pattern: /^[^\n]+\n[ \t]*\n[ \t]*\S/g,
        text: () => 'a body after a blank line',
      },
      {
        pattern:
          /\n[ \t]*\n(?:(?:BREAKING CHANGE|[A-Za-z][\w-]*)(?:: | #)[^\n]*(?:\n|$))+$/g,
        text: () => 'a footer, such as Refs: or BREAKING CHANGE:',
      },
    ],
  },
  {
    name: 'Gherkin',
    task: 'Describe acceptance criteria for an export button on a reports page.',
    spelled:
      'Write a scenario with separate lines beginning Given, When, and Then in that order.',
    rules: [
      { label: 'A line starts with Given', test: has(/^\s*Given\s/im) },
      { label: 'A line starts with When', test: has(/^\s*When\s/im) },
      { label: 'A line starts with Then', test: has(/^\s*Then\s/im) },
      {
        label: 'Given, When and Then lines follow one another, in that order',
        test: has(
          /(?:^|\n)\s*Given\s+[^\n]+\n\s*When\s+[^\n]+\n\s*Then\s+[^\n]+/i,
        ),
      },
    ],
    extras: [
      {
        pattern: /^[ \t]*Feature:/gm,
        text: (found) => plural(found.length, 'Feature line'),
      },
      {
        pattern: /^[ \t]*Scenario(?: Outline)?:/gm,
        text: (found) => plural(found.length, 'Scenario title'),
      },
      {
        pattern: /^[ \t]*(?:And|But) /gm,
        text: (found) => plural(found.length, 'And or But step'),
      },
    ],
  },
  {
    name: 'BLUF',
    task: 'Recommend whether to release an export button when its download sometimes fails.',
    spelled:
      'Put the bottom-line recommendation in the first sentence, before any evidence or reasons.',
    rules: [
      // A label such as "BLUF:", "**BLUF:**", "## Bottom line" or "Recommendation (BLUF):" may come first. Nothing else may.
      {
        label: 'Opens with the decision: release, ship, delay, hold or do not',
        test: starts(
          /^(?:#{1,6}[ \t]*)?(?:[*_]{0,2}(?:BLUF|bottom line(?: up front)?|recommendation|decision)[\s:*_()—–-]*){0,2}[*_]{0,2}(?:do not|don[’']t|delay|hold|release|ship)\b/i,
        ),
      },
    ],
    extras: [
      // From the second line on: a "BLUF:" label on the first line is not a heading for the details.
      {
        pattern:
          /(?<=\n)[ \t]*(?:#{1,6}[ \t]+\S|\*\*[^*\n]+\*\*[ \t]*$|\*\*[^*\n]+:\*\*|[A-Z][A-Za-z ]{0,30}:[ \t]*$)/gm,
        text: (found) =>
          `${plural(found.length, 'heading')} for the details after it`,
      },
    ],
  },
  {
    name: 'MoSCoW',
    task: 'Prioritize export button requirements: CSV download, PDF download, audit log, and animated progress.',
    spelled:
      'Place requirements under four headings: Must have, Should have, Could have, and Won’t have, in that order.',
    rules: [
      ...MOSCOW.map(({ heading, pattern }) => ({
        label: `Has “${heading}”`,
        test: has(pattern),
      })),
      {
        label: 'The four headings come in that order',
        test: (text) => {
          const positions = MOSCOW.map(({ pattern }) => text.search(pattern))
          return positions.every(
            (pos, i) => pos >= 0 && (i === 0 || pos > positions[i - 1]),
          )
        },
      },
    ],
    extras: [
      {
        pattern: /(?:won[’']?t|will not) have[ \t]*\(?this time/gi,
        text: () => '“Won’t have” marked as “this time”',
      },
    ],
  },
  {
    name: 'RFC 2119 keywords',
    task: 'Write three requirements for the export button: access control is mandatory, a progress indicator is recommended, and a cancel button is optional.',
    spelled:
      'Use the uppercase words MUST, SHOULD, and MAY once each for mandatory, recommended, and optional requirements, respectively.',
    rules: ['MUST', 'SHOULD', 'MAY'].map((word) => ({
      label: `Uses ${word} in capitals`,
      test: has(new RegExp(`\\b${word}\\b`)),
    })),
    extras: [
      {
        pattern: /RFC[ \t]?2119|BCP[ \t]?14/g,
        text: () => 'a note that the words follow RFC 2119',
      },
      {
        pattern:
          /\b(?:MUST NOT|SHALL NOT|SHALL|SHOULD NOT|NOT RECOMMENDED|REQUIRED|RECOMMENDED|OPTIONAL)\b/g,
        text: (found) => `other keywords: ${[...new Set(found)].join(', ')}`,
      },
    ],
  },
]

export function guidance(format: Format, mode: Mode) {
  if (mode === 'none') {
    return ''
  }
  if (mode === 'spelled') {
    return format.spelled
  }

  return `Use ${format.name}.`
}

/** The three versions of one task: the guidance each adds to the instructions, and its size in tokens. */
export function versions(format: Format) {
  return MODES.map((mode) => {
    const text = guidance(format, mode)
    return { mode, guidance: text, tokens: countTokens(text) }
  })
}

/** Runs the check: each rule met or not, and the extras of an answer that passed. */
export function score(format: Format, text: string) {
  const rules = format.rules.map((rule) => ({
    label: rule.label,
    met: rule.test(text),
  }))
  const passed = rules.every((rule) => rule.met)
  // Extras mean "more of the standard", so they count only in an answer that is in the format.
  const extras = passed
    ? format.extras.flatMap((extra) => {
        const found = text.match(extra.pattern) ?? []
        return found.length ? [extra.text(found)] : []
      })
    : []

  return { passed, rules, extras }
}

export interface Row {
  format: string
  mode: Mode
  /** The guidance added to the instructions: empty, the spelled-out rules, or "Use <name>." */
  guidance: string
  guidanceTokens: number
  passed: boolean
  rules: { label: string; met: boolean }[]
  /** Parts of the standard in the answer that the spelled-out rules do not ask for, such as "4 Scenario titles". */
  extras: string[]
  text: string
  usage: Usage
  request: ShownRequest
  response: unknown
}

export async function compare(
  options: { provider?: string; model?: string; formats?: string[] } = {},
) {
  const provider = pickProvider(options.provider)
  const names = options.formats
  const formats = names
    ? FORMATS.filter((format) => names.includes(format.name))
    : FORMATS
  if (!formats.length) {
    throw new Error('Choose at least one known format.')
  }

  const rows: Row[] = []
  for (const format of formats) {
    for (const version of versions(format)) {
      const instructions = [BASE_INSTRUCTIONS, version.guidance]
        .filter(Boolean)
        .join(' ')
      const result = await createResponse(
        {
          ...(options.model ? { model: options.model } : {}),
          instructions,
          input: [userMessage(format.task)],
        },
        { provider },
      )

      rows.push({
        format: format.name,
        mode: version.mode,
        guidance: version.guidance,
        guidanceTokens: version.tokens,
        ...score(format, result.text),
        text: result.text,
        usage: result.usage,
        request: result.request,
        response: result.response,
      })
    }
  }

  return rows
}
