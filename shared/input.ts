// Checks for values that a user types: a flag in index.ts, a field of the
// JSON that a page sends to api.ts. A missing value (undefined or null) gives
// undefined, so the caller sets the default with `??`. A wrong value throws
// a message that says what to type.

const missing = (value: unknown) => value === undefined || value === null

/** The value when `list` holds it. Throws: Unknown mode "x". Use one of: a, b. */
export function oneOf<T extends string>(
  value: string,
  list: readonly T[],
  name: string,
): T
export function oneOf<T extends string>(
  value: unknown,
  list: readonly T[],
  name: string,
): T | undefined
export function oneOf<T extends string>(
  value: unknown,
  list: readonly T[],
  name: string,
): T | undefined {
  if (missing(value)) {
    return undefined
  }
  const found = list.find((item) => item === value)
  if (found === undefined) {
    throw unknown(name, value, list)
  }
  return found
}

/** The item of `list` whose id is `id`. Throws like oneOf(). */
export function byId<T extends { id: string }>(
  list: readonly T[],
  id: string,
  name: string,
): T
export function byId<T extends { id: string }>(
  list: readonly T[],
  id: unknown,
  name: string,
): T | undefined
export function byId<T extends { id: string }>(
  list: readonly T[],
  id: unknown,
  name: string,
): T | undefined {
  if (missing(id)) {
    return undefined
  }
  const found = list.find((item) => item.id === id)
  if (!found) {
    throw unknown(
      name,
      id,
      list.map((item) => item.id),
    )
  }
  return found
}

/** A whole number from min to max, given as 3 or as the text '3'. */
export function wholeNumber(
  value: string | number,
  name: string,
  min: number,
  max: number,
): number
export function wholeNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined
export function wholeNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (missing(value)) {
    return undefined
  }
  const number =
    typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)
      ? Number(value)
      : value
  if (
    typeof number !== 'number' ||
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`)
  }
  return number
}

function unknown(name: string, value: unknown, list: readonly string[]) {
  return new Error(
    `Unknown ${name} ${JSON.stringify(value)}. Use one of: ${list.join(', ')}.`,
  )
}
