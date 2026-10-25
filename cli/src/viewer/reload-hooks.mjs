// A module hook for the viewer. When a module is loaded with ?mex-v=<version>,
// its relative imports get the same version, and so do theirs. A new version
// of an example's folder then loads all of its own modules fresh, not only
// api.ts. Shared modules (#shared/...) keep one copy.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context)
  const version = context.parentURL
    ? new URL(context.parentURL).searchParams.get('mex-v')
    : null
  if (
    !version ||
    !/^\.\.?\//.test(specifier) ||
    !result.url.startsWith('file:')
  ) {
    return result
  }
  const url = new URL(result.url)
  url.searchParams.set('mex-v', version)
  return { ...result, url: url.href }
}
