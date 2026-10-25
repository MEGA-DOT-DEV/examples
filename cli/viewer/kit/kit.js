// Browser helpers for example pages (examples/<name>/ui/). Plain ES module.
//   import { call, el, copyText } from '../../kit/kit.js'

// Every URL is relative to the viewer's root, found from this file's own
// address (<root>/kit/kit.js). The viewer can run at / on this computer or
// under a path on a shared server, like /examples/.
const ROOT = new URL('../', import.meta.url)
const api = (path) => new URL(`api/${path}`, ROOT)

/** The example name, from the page address <root>/ui/<name>/. */
export const example =
  /^ui\/([a-z0-9-]+)/.exec(
    location.pathname.slice(ROOT.pathname.length),
  )?.[1] ?? ''

/**
 * Calls a function that the example exports from api.ts.
 * Resolves with its result. Rejects with an Error; error.missingKey names a
 * key to add with `npx mex setup` when that is the cause.
 */
export async function call(fn, input = {}) {
  const response = await fetch(api(`items/${example}/call/${fn}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
  if (!data.ok) {
    const error = new Error(data.error ?? `HTTP ${response.status}`)
    error.missingKey = data.missingKey ?? null
    // The viewer's own code changed after it started: the error may come from the old code.
    error.restart = data.restart === true
    throw error
  }
  return data.result
}

/** Creates an element: el('button', { class: 'mx-btn', onclick }, 'Text'). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value == null) {
      continue
    }
    if (name.startsWith('on')) {
      node.addEventListener(name.slice(2), value)
    } else if (name === 'style' && typeof value === 'object') {
      // setProperty also sets CSS variables (--name); Object.assign does not.
      for (const [prop, v] of Object.entries(value)) {
        node.style.setProperty(
          prop.startsWith('--')
            ? prop
            : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
          v,
        )
      }
    } else {
      node.setAttribute(name, value === true ? '' : value)
    }
  }
  node.append(
    ...children
      .flat(Infinity)
      .filter((child) => child != null && child !== false),
  )
  return node
}

/** Copies text and briefly changes the button label. */
export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text)
    if (button) {
      const label = button.textContent
      button.textContent = 'Copied'
      setTimeout(() => (button.textContent = label), 1200)
    }
  } catch {}
}

/** Waits until calls stop for `ms`, then runs fn with the last arguments. */
export function debounce(fn, ms = 150) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/**
 * JSON with two-space indents, but short lists of numbers or strings on one
 * line, so a token's bytes do not take ten lines.
 */
export function prettyJson(value) {
  return JSON.stringify(value, null, 2).replace(
    /\[\s*\n(\s*(?:-?[\d.e+-]+|"[^"\n,\\]{0,24}"|true|false|null),?\s*\n)+\s*\]/g,
    (list) => {
      const items = list
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
      const line = `[${items.join(', ')}]`
      return line.length <= 80 ? line : list
    },
  )
}

/**
 * A code block in the kit style, with a copy button. With a language
 * (json, ts, bash, ...), the viewer adds syntax colors a moment later.
 */
export function codeBlock(text, lang = '') {
  const copy = el('button', { class: 'mx-copy', type: 'button' }, 'Copy')
  copy.addEventListener('click', () => copyText(text, copy))
  const pre = el('pre', {}, el('code', {}, text))
  const figure = el(
    'figure',
    { class: 'mx-code' },
    lang ? el('span', { class: 'mx-code-lang' }, lang) : null,
    copy,
    pre,
  )
  if (lang) {
    void colorize(pre, text, lang)
  }
  return figure
}

async function colorize(pre, code, language) {
  try {
    const response = await fetch(api('highlight'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
    })
    const { html } = await response.json()
    if (!html || !pre.isConnected) {
      return
    }
    const holder = document.createElement('div')
    holder.innerHTML = html
    pre.replaceWith(holder.firstElementChild)
  } catch {
    // Plain text is fine: the colors are only a help.
  }
}

// Inside the viewer: tell it how tall this page is. The viewer sizes the
// frame to fit, so the page never scrolls inside the frame.
if (window.parent !== window) {
  document.documentElement.classList.add('mx-embedded')
  const report = () =>
    window.parent.postMessage(
      {
        type: 'mex:height',
        height: Math.ceil(document.body.getBoundingClientRect().height),
      },
      location.origin,
    )
  const start = () => new ResizeObserver(report).observe(document.body)
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
  addEventListener('load', report)
}

// ── Provider picker, errors and usage: the same on every page ──────────

/**
 * A row with a provider switch (OpenRouter, OpenAI) and a model field.
 * Providers without a key are disabled. The model field is empty by default,
 * which means "the provider's default model" (shown as the placeholder).
 *
 *   const picker = await providerPicker(document.getElementById('provider'))
 *   await call('run', { ...picker.value(), prompt })
 *
 * options.purpose: 'default', 'logprobs' or 'embedding' (which default model to show).
 * options.model: false hides the model field (a page that picks models itself).
 * options.onChange: called when the provider or the model changes.
 * Returns { value(), hasKey(), refresh() }.
 */
export async function providerPicker(container, options = {}) {
  const purpose = options.purpose ?? 'default'
  let providers = []
  let provider = null
  const seg = el('div', {
    class: 'mx-seg',
    role: 'group',
    'aria-label': 'Provider',
  })
  const modelInput = el('input', {
    class: 'mx-input mx-input--small mx-picker-model',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': 'Model',
  })
  container.classList.add('mx-picker')
  const withModel = options.model !== false
  container.replaceChildren(
    el('span', { class: 'mx-label' }, 'Provider'),
    seg,
    ...(withModel
      ? [el('span', { class: 'mx-label' }, 'Model'), modelInput]
      : []),
  )
  const changed = () => options.onChange?.()
  modelInput.addEventListener('change', changed)

  function render() {
    seg.replaceChildren(
      ...providers.map((p) =>
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(p.id === provider),
            disabled: !p.set,
            title: p.set
              ? `${p.name} · default model ${p.model}`
              : `Add ${p.envKey}: run npx mex setup`,
            onclick: () => {
              if (p.id === provider) {
                return
              }
              provider = p.id
              modelInput.value = ''
              render()
              changed()
            },
          },
          p.name,
        ),
      ),
    )
    const current = providers.find((p) => p.id === provider)
    modelInput.placeholder = current ? current.model : 'add a key first'
    modelInput.disabled = !current
  }

  async function refresh() {
    const response = await fetch(
      api(`llm?purpose=${encodeURIComponent(purpose)}`),
    )
    providers = (await response.json()).providers
    const ready = providers.filter((p) => p.set)
    if (!ready.some((p) => p.id === provider)) {
      provider = ready[0]?.id ?? null
    }
    render()
  }

  await refresh()
  // A key added with `npx mex setup` shows up when you come back to the tab.
  addEventListener('focus', () => void refresh())
  return {
    value: () => ({
      provider,
      model: (withModel && modelInput.value.trim()) || undefined,
    }),
    hasKey: () => provider !== null,
    providers: () => providers,
    refresh,
  }
}

/**
 * Shows an error in a container: a setup hint for a missing key, or the
 * message. Pass null to clear it.
 */
export function showError(container, error) {
  if (!error) {
    return container.replaceChildren()
  }
  if (error.restart) {
    return container.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('span', { class: 'mx-label' }, 'Restart the viewer'),
        el(
          'p',
          {},
          'Its own code changed after it started, for example after ',
          el('code', {}, 'git pull'),
          '. Stop ',
          el('code', {}, 'npx mex open'),
          ' with Ctrl+C and start it again, then run this page again.',
        ),
        el(
          'p',
          { class: 'mx-small mx-muted' },
          `The error from the old code: ${error.message}`,
        ),
      ),
    )
  }
  if (error.missingKey) {
    const keys = String(error.missingKey).split(' or ')
    return container.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('span', { class: 'mx-label' }, 'Key needed'),
        el(
          'p',
          {},
          'Add ',
          keys.flatMap((k, i) => [i ? ' or ' : null, el('code', {}, k)]),
          ': run ',
          el('code', {}, 'npx mex setup'),
          ' in a terminal, in the repo folder. The page uses the new key without a restart.',
        ),
      ),
    )
  }
  container.replaceChildren(
    el(
      'div',
      { class: 'mx-callout mx-callout--warn' },
      el('span', { class: 'mx-label' }, 'The request failed'),
      el('p', {}, error.message),
    ),
  )
}

/** A callout for a page whose provider has no key yet. */
export function missingKeyNote(container) {
  showError(container, { missingKey: 'OPENROUTER_API_KEY or OPENAI_API_KEY' })
}

export function formatCost(usd) {
  if (usd == null) {
    return '—'
  }
  if (usd === 0) {
    return '$0'
  }
  // Two significant digits in plain decimals, without trailing zeros: never 6.2e-7.
  if (usd < 0.01) {
    return `$${usd
      .toFixed(Math.min(20, 1 - Math.floor(Math.log10(usd))))
      .replace(/0+$/, '')
      .replace(/\.$/, '')}`
  }
  return `$${usd.toFixed(4)}`
}

/** "31 in · 12 out (8 reasoning) · $0.000021 est." from a Usage object. */
export function usageText(usage) {
  if (!usage) {
    return ''
  }
  // Thousands separators: "20,693 in" reads faster than "20693 in".
  const n = (value) => Number(value ?? 0).toLocaleString('en-US')
  // Embeddings have input only, so a usage without outputTokens shows no "out" part.
  const parts = [`${n(usage.inputTokens)} in`]
  if (usage.outputTokens != null) {
    parts.push(
      `${n(usage.outputTokens)} out${usage.reasoningTokens ? ` (${n(usage.reasoningTokens)} reasoning)` : ''}`,
    )
  }
  if (usage.cost != null) {
    parts.push(
      `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`,
    )
  }
  return parts.join(' · ')
}

/** Two collapsible code blocks: the request sent and the response received. */
export function requestResponse(request, response) {
  return el(
    'div',
    { class: 'mx-stack' },
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, el('span', { class: 'mx-label' }, 'Request sent')),
      codeBlock(prettyJson(request), 'json'),
    ),
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, el('span', { class: 'mx-label' }, 'Response received')),
      codeBlock(prettyJson(response), 'json'),
    ),
  )
}

/** Sets a button to a busy label while a promise runs. */
export async function busy(button, label, run) {
  const idle = button.textContent
  button.disabled = true
  button.textContent = label
  try {
    return await run()
  } finally {
    button.disabled = false
    button.textContent = idle
  }
}

/**
 * Model output as readable text. A small, safe subset of Markdown: fenced
 * code blocks, `inline code`, **bold** and *italic*. Simple LaTeX math reads
 * as plain text: \(\frac{2}{3}\) shows as 2/3. It builds elements and never
 * parses HTML, so model text cannot inject markup.
 */
export function modelText(text, className = 'mx-output') {
  const root = el('div', { class: `${className} mx-model-text` })
  const parts = String(text).split(/```([\w-]*)\n?([\s\S]*?)(?:```|$)/g)
  // split() with two groups: prose, lang, code, prose, lang, code, ...
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i]
    if (prose.trim()) {
      for (const paragraph of prose.trim().split(/\n{2,}/)) {
        root.append(el('p', {}, inline(paragraph)))
      }
    }
    if (i + 2 < parts.length) {
      root.append(
        codeBlock(parts[i + 2].replace(/\n$/, ''), parts[i + 1] || ''),
      )
    }
  }
  return root
}

function inline(text) {
  const out = []
  // Math: \( \), \[ \], $$ $$, and $ $ only around a command, so "$5 and $10" stays text.
  const pattern =
    /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\$([^$\n]*\\[a-zA-Z][^$\n]*)\$/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      out.push(text.slice(last, match.index))
    }
    if (match[1] !== undefined) {
      out.push(el('code', {}, match[1]))
    } else if (match[2] !== undefined) {
      out.push(el('strong', {}, inline(match[2])))
    } else if (match[3] !== undefined) {
      out.push(el('em', {}, inline(match[3])))
    } else {
      out.push(mathText(match[4] ?? match[5] ?? match[6] ?? match[7]))
    }
    last = match.index + match[0].length
  }
  if (last < text.length) {
    out.push(text.slice(last))
  }
  return out
}

const MATH_SYMBOLS = {
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  approx: '≈',
  neq: '≠',
  ne: '≠',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  to: '→',
  rightarrow: '→',
  Rightarrow: '⇒',
  infty: '∞',
  ldots: '…',
  dots: '…',
  cdots: '…',
  mid: '|',
  quad: ' ',
  qquad: ' ',
  ',': ' ',
  ';': ' ',
  ':': ' ',
  ' ': ' ',
  '!': '',
  '%': '%',
  $: '$',
  '{': '{',
  '}': '}',
}

/** LaTeX math as plain text: fractions as a/b, \text{} as its words, common symbols as characters. Other commands stay as written. */
function mathText(tex) {
  const part = (s) => (/^[\w.]+$/.test(s.trim()) ? s.trim() : `(${s.trim()})`)
  let text = tex
  // Innermost first, so \frac{\frac{1}{2}}{3} works too.
  for (let before = ''; before !== text; ) {
    before = text
    text = text
      .replace(
        /\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g,
        (_, a, b) => `${part(a)}/${part(b)}`,
      )
      .replace(
        /\\(?:text|textbf|textit|mathrm|mathbf|mathit|operatorname|boxed)\{([^{}]*)\}/g,
        '$1',
      )
  }
  return text
    .replace(/\\left|\\right/g, '')
    .replace(/(?<!\\)[{}]/g, '')
    .replace(
      /\\([a-zA-Z]+|[,;: !%${}])/g,
      (command, name) => MATH_SYMBOLS[name] ?? command,
    )
    .replace(/\s+/g, ' ')
    .trim()
}
