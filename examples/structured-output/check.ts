// The schema checker is shared (shared/json-schema.ts). This file adds what
// only this example needs: reading a schema that the learner typed.
import { isObject, type JsonSchema } from '#shared/json-schema.ts'

export {
  type CheckResult,
  check,
  type JsonSchema,
} from '#shared/json-schema.ts'

export const MAX_SCHEMA_CHARS = 10_000

/**
 * Reads a schema that a user typed. Throws an Error that says what to fix.
 * It checks only what this example needs. Strict mode rules (every property
 * required, no extra properties) are left to the API, so you see its error.
 */
export function readSchema(text: string): JsonSchema {
  if (text.length > MAX_SCHEMA_CHARS) {
    throw new Error(`Keep the schema under ${MAX_SCHEMA_CHARS} characters.`)
  }

  let schema: unknown
  try {
    schema = JSON.parse(text)
  } catch (error) {
    throw new Error(`The schema is not valid JSON: ${(error as Error).message}`)
  }

  if (!isObject(schema)) {
    throw new Error('The schema must be a JSON object.')
  }

  if (schema.type !== 'object') {
    throw new Error(
      'The schema needs "type": "object" at the top. Structured outputs return an object.',
    )
  }

  if (!isObject(schema.properties)) {
    throw new Error(
      'The schema needs "properties": an object with one entry per field.',
    )
  }

  return schema as JsonSchema
}
