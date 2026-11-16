// Markdown and YAML files are bundled as text (see `rules` in wrangler.jsonc).
declare module '*.md' {
  const text: string
  export default text
}
declare module '*.yaml' {
  const text: string
  export default text
}
