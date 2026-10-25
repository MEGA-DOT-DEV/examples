import {
  busy,
  call,
  codeBlock,
  el,
  prettyJson,
  showError,
} from '../../kit/kit.js'

// ── How to start: one command per step, for the harness you use ────────
const PROXY = 'http://127.0.0.1:8787'
const HARNESSES = [
  {
    id: 'claude',
    label: 'Claude Code',
    upstream: 'anthropic',
    title: 'In a second terminal, start Claude Code through the proxy:',
    command: `ANTHROPIC_BASE_URL=${PROXY} claude`,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    upstream: 'openai',
    title:
      'Point your tool at the proxy. Tools built on the OpenAI SDK read this variable; others have a base URL setting.',
    command: `OPENAI_BASE_URL=${PROXY}/v1`,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    upstream: 'openrouter',
    title: "Set your tool's OpenAI-compatible base URL to the proxy:",
    command: `${PROXY}/v1`,
  },
]

function renderStart(id) {
  const harness = HARNESSES.find((h) => h.id === id) ?? HARNESSES[0]
  try {
    localStorage.setItem('ri-harness', harness.id)
  } catch {}

  document.getElementById('harness').replaceChildren(
    ...HARNESSES.map((h) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(h.id === harness.id),
          onclick: () => renderStart(h.id),
        },
        h.label,
      ),
    ),
  )

  document
    .getElementById('step-proxy')
    .replaceChildren(
      codeBlock(
        `npx mex run request-inspector --upstream ${harness.upstream}`,
        'bash',
      ),
    )

  document.getElementById('step-harness-title').textContent = harness.title
  document
    .getElementById('step-harness')
    .replaceChildren(
      codeBlock(harness.command, harness.id === 'openrouter' ? '' : 'bash'),
    )
}

let savedHarness = null
try {
  savedHarness = localStorage.getItem('ri-harness')
} catch {}
renderStart(savedHarness)

const rows = document.getElementById('rows')
const notice = document.getElementById('notice')
const clearButton = document.getElementById('clear')
const probesBox = document.getElementById('probes')
const startBox = document.getElementById('start-box')
let startTouched = false
// Only a click on the summary counts: refresh() also sets .open, and that fires toggle too.
startBox.querySelector('summary').addEventListener('click', () => {
  startTouched = true
})
let selected = null
// The demo request on screen, or null. The demo never joins the list of captures.
let demoId = null
let demoList = null
let kinds = {}
try {
  probesBox.checked = localStorage.getItem('ri-probes') === '1'
} catch {}

const num = (n) => n.toLocaleString('en-US')
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const size = (n) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)} MB`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)} KB`
      : `${n} B`
const pct = (part, total) =>
  total
    ? `${((part / total) * 100).toFixed(part / total < 0.01 && part ? 1 : 0)}%`
    : '0%'
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB')

// ── The list of captures ───────────────────────────────────────────────

async function refresh() {
  try {
    const { dir, captures } = await call('list')
    document.getElementById('dir').textContent = `${dir}/`
    document.getElementById('demo-close').textContent = captures.length
      ? 'Back to your captures'
      : 'Close the demo'

    const probes = captures.filter((c) => !c.isModel).length
    const shown = probesBox.checked
      ? captures
      : captures.filter((c) => c.isModel)

    document.getElementById('count').textContent = captures.length
      ? `${plural(captures.length - probes, 'model request')}. Select one to see what it sends.`
      : 'Each request that your harness sends through the proxy.'

    // The steps matter until the first capture or the demo; after that they only take room.
    if (!startTouched) {
      startBox.open = captures.length === 0 && !demoId
    }

    document.getElementById('probes-label').textContent =
      `Show health checks (${probes})`
    document.getElementById('probes-box').hidden = probes === 0
    clearButton.hidden = captures.length === 0
    document.getElementById('empty').hidden =
      captures.length > 0 || demoId !== null
    document.getElementById('privacy').hidden = captures.length === 0
    document.querySelector('.ri-list').hidden = captures.length === 0

    rows.replaceChildren(
      ...shown.map((c) =>
        el(
          'tr',
          {
            class: `ri-row${c.id === selected ? ' is-selected' : ''}${c.isModel ? '' : ' is-probe'}`,
            tabindex: '0',
            'data-id': c.id,
            onclick: () => open(c.id),
            onkeydown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open(c.id)
              }
            },
          },
          el('td', { class: 'num' }, clock(c.time)),
          // The query (?beta=true) is in the tooltip: the path alone keeps the row on one line.
          el(
            'td',
            {},
            el(
              'code',
              { title: `${c.method} ${c.path}` },
              `${c.method} ${c.path.split('?')[0]}`,
            ),
          ),
          el(
            'td',
            {},
            c.model
              ? el('code', {}, c.model)
              : el('span', { class: 'mx-muted' }, '—'),
          ),
          el('td', { class: 'num' }, c.isModel ? String(c.messages) : '—'),
          el('td', { class: 'num' }, c.isModel ? String(c.tools) : '—'),
          el(
            'td',
            { class: 'num' },
            !c.isModel
              ? '—'
              : c.usage
                ? num(c.usage.input)
                : el(
                    'span',
                    {
                      class: 'mx-muted',
                      title: 'Local estimate: this response had no usage',
                    },
                    `~${num(c.totalTokens)}`,
                  ),
          ),
          el(
            'td',
            { class: 'num' },
            c.usage ? pct(c.usage.cachedRead, c.usage.input) : '—',
          ),
          el(
            'td',
            { class: `num ${c.status >= 400 || !c.status ? 'mx-bad' : ''}` },
            String(c.status || '—'),
          ),
        ),
      ),
    )

    notice.replaceChildren()

    // While the demo is open, a refresh updates the list and leaves the demo on screen.
    if (!demoId && !shown.some((c) => c.id === selected)) {
      selected = null
      document.getElementById('detail').hidden = true
      if (shown[0]) {
        await open(shown[0].id)
      }
    }
  } catch (error) {
    showError(notice, error)
  }
}

// ── One request ────────────────────────────────────────────────────────

function readout(label, value, note, text = false) {
  return el(
    'div',
    { class: `mx-readout${text ? ' ri-text' : ''}` },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, value),
    note ? el('span', { class: 'mx-small mx-muted' }, note) : null,
  )
}

/** A <details> whose content is built the first time it opens. */
function lazy(details, build) {
  details.addEventListener('toggle', () => {
    if (!details.open || details.dataset.ready) {
      return
    }
    details.dataset.ready = '1'
    details.append(build())
  })

  return details
}

function blockRow(b, mark) {
  const titled = b.title && b.title !== b.preview
  // The first line is often the first heading: say it once.
  const heads = b.headings.filter((h) => h !== b.preview)
  const main = el(
    'span',
    { class: 'ri-main' },
    titled ? el('b', {}, b.title) : null,
    b.preview
      ? el('span', { class: titled ? 'ri-preview' : '' }, b.preview)
      : null,
    heads.length ? el('span', { class: 'ri-heads' }, heads.join(' · ')) : null,
  )

  const row = el(
    'details',
    { class: `ri-block ri-kind--${b.kind}${mark ? ` is-${mark}` : ''}` },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'ri-msg' },
        b.message == null ? '' : String(b.message),
      ),
      el('span', { class: 'ri-tag' }, kinds[b.kind] ?? b.kind),
      main,
      el('span', { class: 'ri-mark' }, mark ?? ''),
      el(
        'span',
        { class: 'ri-tok' },
        b.kind === 'attachment' ? '' : `~${num(b.tokens)}`,
      ),
    ),
  )

  lazy(row, () =>
    el(
      'div',
      { class: 'ri-block-body' },
      b.text
        ? codeBlock(b.text)
        : el(
            'p',
            { class: 'mx-small mx-muted' },
            b.kind === 'attachment' ? b.preview : 'No text.',
          ),
      b.cut
        ? el(
            'p',
            { class: 'mx-small mx-muted' },
            `This shows the first ${num(b.text.length)} of ${num(b.chars)} characters. The capture file holds all of it.`,
          )
        : null,
    ),
  )

  return b.cache
    ? [row, el('div', { class: 'ri-cache' }, `Cache breakpoint · ${b.cache}`)]
    : [row]
}

function toolRow(g, total) {
  const deferred = g.tools.filter((t) => t.deferred).length
  const row = el(
    'details',
    { class: 'ri-block ri-kind--tools' },
    el(
      'summary',
      {},
      el('span', { class: 'ri-msg' }, String(g.count)),
      el('span', { class: 'ri-tag' }, g.source),
      el(
        'span',
        { class: 'ri-main' },
        el(
          'span',
          { class: 'ri-preview' },
          g.tools
            .slice(0, 4)
            .map((t) => t.name.replace(/^mcp__.+?__/, ''))
            .join(', ') + (g.count > 4 ? ', …' : ''),
        ),
        deferred
          ? el(
              'span',
              { class: 'ri-heads' },
              `${deferred} deferred: loaded only after a tool search`,
            )
          : null,
      ),
      el('span', { class: 'ri-mark' }, pct(g.tokens, total)),
      el('span', { class: 'ri-tok' }, `~${num(g.tokens)}`),
    ),
  )

  lazy(row, () =>
    el(
      'div',
      { class: 'mx-table-wrap ri-block-body' },
      el(
        'table',
        { class: 'mx-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Tool'),
            el('th', {}, 'Description, first sentence'),
            el('th', { class: 'num' }, 'Tokens'),
          ),
        ),
        el(
          'tbody',
          {},
          g.tools.map((t) =>
            el(
              'tr',
              {},
              el(
                'td',
                {},
                el('code', {}, t.name),
                t.deferred
                  ? el('div', { class: 'mx-small mx-muted' }, 'deferred')
                  : null,
              ),
              el('td', { class: 'mx-small' }, t.summary || '—'),
              el('td', { class: 'num' }, `~${num(t.tokens)}`),
            ),
          ),
        ),
      ),
    ),
  )

  return row
}

/** "14 messages the same · 1 changed · 2 new · …": what this request did to the one before. */
function changeText(d) {
  const p = d.previous
  if (!p) {
    return null
  }

  const c = p.change
  const fresh = c.messagesAdded - c.messagesChanged
  const facts = [
    `${c.messagesKept} of ${plural(c.messagesBefore, 'message')} the same`,
  ]

  if (c.messagesChanged) {
    facts.push(`${c.messagesChanged} changed`)
  }
  if (fresh > 0) {
    facts.push(`${fresh} new`)
  }
  if (fresh < 0) {
    facts.push(`${-fresh} fewer`)
  }

  facts.push(
    c.systemChanged ? 'system prompt changed' : 'system prompt the same',
  )

  if (c.toolsAdded.length) {
    facts.push(`${plural(c.toolsAdded.length, 'tool')} added`)
  }
  if (c.toolsRemoved.length) {
    facts.push(`${plural(c.toolsRemoved.length, 'tool')} removed`)
  }
  if (!c.toolsAdded.length && !c.toolsRemoved.length) {
    facts.push('tools the same')
  }

  const a = p.entry.usage?.input
  const b = d.entry.usage?.input
  if (a && b) {
    facts.push(`input ${b >= a ? '+' : '−'}${num(Math.abs(b - a))} tokens`)
  }

  return [
    el('b', {}, `Since the previous request (${clock(p.time)}): `),
    facts.join(' · '),
    '.',
  ]
}

/** User messages against what the harness added: system prompt, tools, system messages and reminders. */
function headlineText(s) {
  const tokensOf = (keys) =>
    s.parts
      .filter((p) => keys.includes(p.key))
      .reduce((sum, p) => sum + p.tokens, 0)

  const user = tokensOf(['user'])
  const added = tokensOf(['instructions', 'tools', 'midsystem', 'reminders'])
  const rest = s.totalTokens - user - added

  return [
    `User messages hold about ${num(user)} tokens, ${pct(user, s.totalTokens)} of the input.`,
    `The harness added about ${num(added)} tokens, ${pct(added, s.totalTokens)}: the system prompt, tool definitions, system messages and reminders.`,
    rest > 0 ? 'Earlier answers and tool calls are the rest.' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function render(d) {
  kinds = d.kinds

  document.getElementById('demo-bar').hidden = !d.demo
  if (d.demo) {
    document.getElementById('demo-pick').replaceChildren(
      ...demoList.map((c, i) =>
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(c.id === d.id),
            onclick: () => openDemo(c.id),
          },
          i === 0 ? 'Newest request' : 'Previous request',
        ),
      ),
    )
  }

  const s = d.summary
  const a = d.anatomy
  const u = d.response.usage
  const model = s.shape !== 'unknown'

  // The headline: the share of the input in user messages, and what the harness added around them.
  document
    .getElementById('headline')
    .replaceChildren(
      ...(model
        ? [
            el(
              'div',
              { class: 'mx-callout' },
              el('span', { class: 'mx-label' }, 'Result'),
              el('p', {}, headlineText(s)),
            ),
          ]
        : []),
    )
  document
    .getElementById('readouts')
    .replaceChildren(
      ...[
        readout(
          'Model',
          s.model ?? '—',
          model ? s.shapeLabel.split(' (')[0] : null,
          true,
        ),
        model
          ? readout(
              'Input tokens',
              u ? num(u.input) : `~${k(s.totalTokens)}`,
              u ? `${pct(u.cachedRead, u.input)} from cache` : 'local estimate',
            )
          : null,
        model
          ? readout(
              'Output tokens',
              u ? num(u.output) : '—',
              d.response.stopReason ?? (u ? null : 'no usage in the response'),
            )
          : null,
      ].filter(Boolean),
    )

  const change = document.getElementById('change')
  const text = changeText(d)
  change.hidden = !text
  if (text) {
    change.replaceChildren(...text)
  }

  document.getElementById('probe-note').hidden = model
  document.getElementById('model-detail').hidden = !model

  if (model) {
    // The stacked bar: one segment per part, in the order of the request.
    const parts = s.parts.filter((p) => p.tokens > 0)

    // Without usage from the API, the readout above already shows this estimate.
    document.getElementById('total').textContent = u
      ? `~${num(s.totalTokens)} tokens`
      : ''

    const bar = document.getElementById('bar')
    bar.setAttribute(
      'aria-label',
      parts.map((p) => `${p.label} ${pct(p.tokens, s.totalTokens)}`).join(', '),
    )
    bar.replaceChildren(
      ...parts.map((p) =>
        el('i', {
          class: `ri-part--${p.key}`,
          title: `${p.label}: ${num(p.tokens)}`,
          style: { flexGrow: String(p.tokens) },
        }),
      ),
    )

    document
      .getElementById('legend')
      .replaceChildren(
        ...parts.map((p) =>
          el(
            'li',
            {},
            el('span', { class: `ri-swatch ri-part--${p.key}` }),
            el('span', {}, p.label),
            el('span', { class: 'ri-legend-num' }, num(p.tokens)),
            el(
              'span',
              { class: 'ri-legend-num mx-muted' },
              pct(p.tokens, s.totalTokens),
            ),
          ),
        ),
      )
  }

  if (model && a) {
    // Messages after the shared start are changed (they were in the last request) or new.
    const c = d.previous?.change
    const markOf = (b) =>
      !c || b.message == null || b.message <= c.messagesKept
        ? null
        : b.message <= c.messagesBefore
          ? 'changed'
          : 'new'

    document.getElementById('system-head').textContent =
      `System prompt · ${plural(a.system.length, 'block')}`
    document
      .getElementById('system-rows')
      .replaceChildren(
        ...(a.system.length
          ? a.system.flatMap((b) => blockRow(b, null))
          : [
              el(
                'p',
                { class: 'mx-small mx-muted' },
                'No system prompt in this request.',
              ),
            ]),
      )

    document.getElementById('tools-head').textContent = a.tools.count
      ? `Tools · ${a.tools.count} from ${plural(a.tools.groups.length, 'source')}`
      : 'Tools'
    document
      .getElementById('tool-rows')
      .replaceChildren(
        ...(a.tools.count
          ? a.tools.groups.map((g) => toolRow(g, a.tools.tokens))
          : [
              el(
                'p',
                { class: 'mx-small mx-muted' },
                'No tool definitions in this request.',
              ),
            ]),
      )

    document.getElementById('conversation-head').textContent =
      `Conversation · ${plural(a.messages, 'message')}`
    document
      .getElementById('conversation-rows')
      .replaceChildren(
        ...(a.conversation.length
          ? a.conversation.flatMap((b) => blockRow(b, markOf(b)))
          : [
              el(
                'p',
                { class: 'mx-small mx-muted' },
                d.bodyNote ?? 'No messages.',
              ),
            ]),
      )

    const dl = (id, pairs) =>
      document
        .getElementById(id)
        .replaceChildren(
          ...pairs.flatMap(([name, value]) => [
            el('dt', {}, name),
            el('dd', {}, value),
          ]),
        )
    dl(
      'settings',
      [...a.settings, ...a.other].map((f) => [f.name, f.value]),
    )

    const r = d.response
    dl('response', [
      ['Status', `HTTP ${r.status} · ${(r.ms / 1000).toFixed(1)} s`],
      ...(r.apiError ? [['Error', r.apiError]] : []),
      ...(r.error ? [['Connection', r.error]] : []),
      ...(u
        ? [
            [
              'Input from cache',
              `${num(u.cachedRead)} (${pct(u.cachedRead, u.input)})`,
            ],
            ...(u.cacheWrite
              ? [['Input written to cache', num(u.cacheWrite)]]
              : []),
            ['Input not cached', num(u.input - u.cachedRead - u.cacheWrite)],
            ...(u.reasoning != null
              ? [['Reasoning in the output', num(u.reasoning)]]
              : []),
          ]
        : [['Usage', 'Not in the response.']]),
      ['Size', `sent ${size(d.requestBytes)} · received ${size(r.bytes)}`],
    ])
  } else if (model) {
    document
      .getElementById('conversation-rows')
      .replaceChildren(
        el(
          'p',
          { class: 'mx-small mx-muted' },
          d.bodyNote ?? 'The body was not kept.',
        ),
      )
  }

  // The raw request loads only when it is opened.
  document.getElementById('raw-note').textContent =
    `headers and body · ${size(d.requestBytes)} · auth redacted`

  const box = document.getElementById('raw-box')
  box.open = false
  const rawEl = document.getElementById('raw')
  rawEl.replaceChildren()

  box.ontoggle = async () => {
    if (!box.open || rawEl.childElementCount) {
      return
    }

    try {
      const raw = await call('raw', { id: d.id, demo: d.demo })
      rawEl.append(
        el('p', { class: 'mx-label ri-raw-label' }, 'Headers'),
        codeBlock(prettyJson(raw.headers), 'json'),
        el('p', { class: 'mx-label ri-raw-label' }, 'Body'),
        raw.bodyCut
          ? [
              el(
                'p',
                { class: 'mx-small mx-muted' },
                `The body has ${num(raw.bodyCut.chars)} characters. This shows the start. The full capture is in ${raw.bodyCut.file}.`,
              ),
              codeBlock(raw.bodyCut.text),
            ]
          : raw.body == null
            ? el(
                'p',
                { class: 'mx-small mx-muted' },
                raw.bodyNote ?? 'No body.',
              )
            : codeBlock(prettyJson(raw.body), 'json'),
      )
    } catch (error) {
      showError(notice, error)
    }
  }

  document.getElementById('detail').hidden = false
}

async function open(id) {
  selected = id
  demoId = null

  for (const row of rows.children) {
    row.classList.toggle('is-selected', row.dataset.id === id)
  }

  try {
    render(await call('get', { id }))
    notice.replaceChildren()
  } catch (error) {
    showError(notice, error)
  }
}

// ── The demo: a recorded request, for learners without a harness ───────

async function openDemo(id = null) {
  try {
    demoList ??= (await call('demo')).captures

    const pick = demoList.find((c) => c.id === id) ?? demoList[0]
    if (!pick) {
      throw new Error(
        'The demo files are missing from tools/request-inspector/demo/.',
      )
    }

    demoId = pick.id
    if (!startTouched) {
      startBox.open = false
    }

    document.getElementById('empty').hidden = true
    selected = null
    for (const row of rows.children) {
      row.classList.remove('is-selected')
    }

    render(await call('get', { id: pick.id, demo: true }))
    notice.replaceChildren()
  } catch (error) {
    showError(notice, error)
  }
}

const demoButton = document.getElementById('demo')
demoButton.addEventListener('click', () =>
  busy(demoButton, 'Opening…', async () => {
    await openDemo(demoId)

    document
      .getElementById('detail')
      .scrollIntoView({ behavior: 'smooth', block: 'start' })
  }),
)
document.getElementById('demo-close').addEventListener('click', () => {
  demoId = null

  document.getElementById('detail').hidden = true
  void refresh()
})

// Two clicks to delete: the first asks, the second deletes.
let armed = null
clearButton.addEventListener('click', async () => {
  if (!armed) {
    clearButton.textContent = 'Click again to delete'
    armed = setTimeout(() => {
      armed = null
      clearButton.textContent = 'Clear captures'
    }, 4000)
    return
  }

  clearTimeout(armed)
  armed = null
  clearButton.textContent = 'Clear captures'

  try {
    const { deleted } = await busy(clearButton, 'Deleting…', () =>
      call('clear'),
    )

    selected = null
    await refresh()

    notice.replaceChildren(
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `Deleted ${deleted} capture files.`,
      ),
    )
  } catch (error) {
    showError(notice, error)
  }
})

probesBox.addEventListener('change', () => {
  try {
    localStorage.setItem('ri-probes', probesBox.checked ? '1' : '0')
  } catch {}

  void refresh()
})

const refreshButton = document.getElementById('refresh')
refreshButton.addEventListener('click', () =>
  busy(refreshButton, 'Loading…', refresh),
)

addEventListener('focus', () => void refresh())
await refresh()
