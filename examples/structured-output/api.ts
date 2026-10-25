// Functions that the browser page (ui/) calls through `npx mex open`.
import { providerInput } from '#shared/llm.ts'
import { readSchema } from './check.ts'
import {
  extract,
  INVENTED_CITY,
  MAX_PROMPT_CHARS,
  NAME_PATTERN,
  PRESETS,
} from './extract.ts'

// Indented JSON, with short objects and lists on one line, so a schema fits the box.
function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /([{[])\n\s*([^{}[\]]*?)\n\s*([}\]])/g,
    (whole, open, inner, close) => {
      const items = inner.split(/,\n\s*/).join(', ')
      const line = open === '{' ? `{ ${items} }` : `[${items}]`

      return line.length <= 72 ? line : whole
    },
  )
}

export function presets() {
  return {
    presets: PRESETS.map((p) => ({ ...p, schema: compactJson(p.schema) })),
    invented: INVENTED_CITY,
  }
}

/** Reads the schema the user typed. No request: the page calls it while you type. */
export function checkSchema(input: { schema?: unknown }) {
  try {
    const schema = readSchema(
      typeof input.schema === 'string' ? input.schema : '',
    )

    return { ok: true, fields: Object.keys(schema.properties ?? {}) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export function run(input: {
  prompt?: unknown
  schema?: unknown
  name?: unknown
  provider?: unknown
  model?: unknown
}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT_CHARS} characters.`)
  }

  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : 'result'
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      'The schema name can use letters, digits, _ and - (max 64).',
    )
  }

  // Check the schema before any request.
  const schema = readSchema(
    typeof input.schema === 'string' ? input.schema : '',
  )

  return extract({ prompt, schema, name, ...providerInput(input) })
}
