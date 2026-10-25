// Functions that the page in ui/ calls through `npx mex open`.
// Each export takes the JSON the page sends and returns JSON.
// Keys stay on this side: read them with getKey() from '#shared/env.ts'.
// It throws a MissingKeyError, which the page shows as a setup hint.
// Put the real logic in its own file, so index.ts can use it too.

export function hello(input: { name?: unknown }) {
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : 'world'
  return { message: `Hello, ${name}!` }
}
