// Syntax highlighting for the viewer, done on the server with Shiki.
// The themes are mega.dev's code themes (mega-dev apps/web/src/drops/shiki.ts):
// keywords red, strings and constants blue, comments dimmed. Shiki writes the
// dark colors inline and the light ones as --shiki-light; kit.css swaps them
// in the light theme, so one HTML string serves both themes.
import {
  createHighlighter,
  type HighlighterGeneric,
  type ThemeRegistrationAny,
} from 'shiki'

const codeTheme = (
  name: string,
  type: 'dark' | 'light',
  ink: {
    background: string
    blue: string
    green: string
    ink: string
    muted: string
    red: string
  },
): ThemeRegistrationAny => ({
  name,
  type,
  colors: { 'editor.background': ink.background, 'editor.foreground': ink.ink },
  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: ink.muted },
    },
    {
      scope: [
        'string',
        'punctuation.definition.string',
        'constant.numeric',
        'constant.language',
        'constant.character.escape',
        'support.constant',
      ],
      settings: { foreground: ink.blue },
    },
    {
      scope: [
        'keyword',
        'keyword.operator.new',
        'keyword.operator.expression',
        'storage.type',
        'storage.modifier',
      ],
      settings: { foreground: ink.red },
    },
    // Diffs: added lines green, removed lines red, hunk headers dimmed (the kit's pass and fail colors).
    {
      scope: ['markup.inserted', 'punctuation.definition.inserted'],
      settings: { foreground: ink.green },
    },
    {
      scope: ['markup.deleted', 'punctuation.definition.deleted'],
      settings: { foreground: ink.red },
    },
    {
      scope: ['meta.diff.range', 'meta.diff.header', 'meta.diff.index'],
      settings: { foreground: ink.muted },
    },
  ],
})

const DARK = codeTheme('mega-code', 'dark', {
  background: '#101010',
  blue: '#7b7bff',
  green: '#4ade80',
  ink: '#f2f2ee',
  muted: '#8a8a93',
  red: '#ff5555',
})
const LIGHT = codeTheme('mega-code-light', 'light', {
  background: '#ffffff',
  blue: '#0000ff',
  green: '#15803d',
  ink: '#1b1b1b',
  muted: '#5f5f68',
  red: '#d80000',
})

export const LANGUAGES = [
  'bash',
  'css',
  'diff',
  'html',
  'js',
  'json',
  'md',
  'ts',
  'yaml',
] as const
type Language = (typeof LANGUAGES)[number]

const ALIASES: Record<string, Language> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  javascript: 'js',
  mjs: 'js',
  cjs: 'js',
  typescript: 'ts',
  mts: 'ts',
  cts: 'ts',
  markdown: 'md',
  yml: 'yaml',
  jsonc: 'json',
}

/** A fence language or a file extension → a language Shiki loaded, or null for plain text. */
export function languageOf(name: string): Language | null {
  const key = name.toLowerCase().replace(/^.*\./, '')
  if ((LANGUAGES as readonly string[]).includes(key)) {
    return key as Language
  }
  return ALIASES[key] ?? null
}

/** Highlights code to `<pre class="shiki">…</pre>`, or returns null for plain text. */
export type Highlight = (code: string, language: string) => string | null

let loading: Promise<HighlighterGeneric<string, string>> | null = null

/** Loads the grammars once per process (about 40 ms). */
export async function loadHighlighter(): Promise<Highlight> {
  loading ??= createHighlighter({
    themes: [DARK, LIGHT],
    langs: [...LANGUAGES],
  }) as Promise<HighlighterGeneric<string, string>>
  const highlighter = await loading
  return (code, language) => {
    const lang = languageOf(language)
    if (!lang) {
      return null
    }
    return highlighter.codeToHtml(code, {
      lang,
      themes: { dark: 'mega-code', light: 'mega-code-light' },
      defaultColor: 'dark',
    })
  }
}
