// A small JSON Schema checker for the schemas the examples send to models
// (structured outputs, function tools). It covers type, properties, required,
// additionalProperties, items and enum. Other keywords are not checked;
// check() lists them in `skipped`.

export type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  enum?: unknown[]
  [keyword: string]: unknown
}

export interface CheckResult {
  ok: boolean
  /** One line per problem, with the path: `$.population: expected integer, got string`. */
  errors: string[]
  /** Keywords this checker does not check, with their path. */
  skipped: string[]
}

const CHECKED = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'description',
  'title',
])

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function typeOf(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }
  return typeof value
}

// An integer is also a number.
const fits = (type: string, value: unknown) =>
  type === typeOf(value) || (type === 'number' && typeOf(value) === 'integer')

/** Checks a parsed value against a schema. */
export function check(schema: JsonSchema, value: unknown): CheckResult {
  const errors: string[] = []
  const skipped: string[] = []
  walk(schema, value, '$', errors, skipped)
  return { ok: errors.length === 0, errors, skipped: [...new Set(skipped)] }
}

function walk(
  schema: unknown,
  value: unknown,
  path: string,
  errors: string[],
  skipped: string[],
): void {
  if (!isObject(schema)) {
    return
  }
  for (const keyword of Object.keys(schema)) {
    if (!CHECKED.has(keyword)) {
      skipped.push(`${path}: ${keyword}`)
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => fits(String(type), value))) {
      errors.push(
        `${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`,
      )
      return
    }
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some(
      (option) => JSON.stringify(option) === JSON.stringify(value),
    )
  ) {
    errors.push(
      `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
    )
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {}
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, name)) {
        errors.push(`${path}: missing required "${name}"`)
      }
    }
    for (const [name, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, name)) {
        walk(properties[name], item, `${path}.${name}`, errors, skipped)
      } else if (schema.additionalProperties === false) {
        errors.push(
          `${path}: "${name}" is not allowed (additionalProperties: false)`,
        )
      } else if (isObject(schema.additionalProperties)) {
        walk(
          schema.additionalProperties,
          item,
          `${path}.${name}`,
          errors,
          skipped,
        )
      }
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    for (const [i, item] of value.entries()) {
      walk(schema.items, item, `${path}[${i}]`, errors, skipped)
    }
  }
}
