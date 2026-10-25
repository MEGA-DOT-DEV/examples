import {
  call,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const button = document.getElementById('run')
const notice = document.getElementById('notice')
const promptBox = document.getElementById('prompt')

const info = await call('thread')
let words = info.words.default
let steps = []
let selected = null

const ROUND_NAME = (round) => (round === 0 ? 'Full thread' : `Round ${round}`)
const find = (kind, round) =>
  steps.find((s) => s.kind === kind && s.round === round)
const done = (kind, round) => {
  const step = find(kind, round)
  return step?.state === 'done' ? step.result : null
}

// ── The thread, with the facts marked ──────────────────────────────────

const factPattern = new RegExp(
  info.facts
    .flatMap((f) => f.match)
    .map((p) => `(?:${p})`)
    .join('|'),
  'gi',
)

function highlight(text) {
  const nodes = []
  let at = 0
  for (const hit of text.matchAll(factPattern)) {
    nodes.push(text.slice(at, hit.index), el('mark', {}, hit[0]))
    at = hit.index + hit[0].length
  }

  nodes.push(text.slice(at))
  return nodes
}

function renderThread() {
  document.getElementById('thread-title').textContent =
    `${info.messages} messages · ${info.fullTokens} tokens · facts marked`

  const heads = [
    'Compacted in round 1',
    'Added before round 2',
    'Added before round 3',
  ]

  document
    .getElementById('thread')
    .replaceChildren(
      ...info.segments.flatMap((segment, i) => [
        el(
          'div',
          { class: 'cc-segment mx-label' },
          `${heads[i] ?? `Added before round ${segment.round}`} · ${segment.messages.length} messages · ${segment.tokens} tokens`,
        ),
        ...segment.messages.map((m) =>
          el(
            'div',
            { class: `cc-msg cc-msg--${m.role}` },
            el('span', { class: 'mx-label' }, m.role),
            el('p', {}, highlight(m.text)),
          ),
        ),
      ]),
    )
}

// ── Context sizes: the compression, round by round ────────────────────

function renderSizes() {
  const rows = [
    {
      label: 'Full thread',
      note: `${info.messages} messages`,
      tokens: info.fullTokens,
      kind: 'thread',
    },
  ]
  for (let round = 1; round <= info.rounds; round++) {
    const c = done('compact', round)
    const added = info.segments[round - 1]
    rows.push({
      label: `Round ${round} input`,
      note:
        round === 1
          ? `${added.messages.length} messages`
          : `summary + ${added.messages.length} new messages`,
      tokens: c ? c.contextTokens : round === 1 ? added.tokens : null,
      kind: 'thread',
    })
    rows.push({
      label: `Round ${round} summary`,
      note: 'replaces the input',
      tokens: c ? c.summaryTokens : null,
      kind: 'summary',
    })
  }

  const most = Math.max(...rows.map((r) => r.tokens ?? 0))
  document.getElementById('sizes').replaceChildren(
    ...rows.map((r) =>
      el(
        'div',
        { class: `cc-size cc-size--${r.kind}` },
        el(
          'span',
          {},
          r.label,
          el('span', { class: 'mx-muted cc-size-note' }, r.note),
        ),
        el(
          'span',
          {
            class: `mx-meter${r.kind === 'summary' ? ' mx-meter--accent' : ''}`,
          },
          el('i', { style: { width: `${((r.tokens ?? 0) / most) * 100}%` } }),
        ),
        el(
          'span',
          { class: 'cc-size-num' },
          r.tokens == null ? '…' : String(r.tokens),
        ),
      ),
    ),
  )

  const last = done('compact', info.rounds)
  document.getElementById('meta').textContent = last
    ? `${Math.round(info.fullTokens / last.summaryTokens)}× smaller than the thread`
    : ''
}

// ── Facts × rounds ─────────────────────────────────────────────────────

function factCell(fact, round) {
  if (round > 0 && fact.round > round) {
    return el('td', { class: 'mx-muted' }, '—')
  }

  const step = find('probe', round)
  if (!step || step.state === 'waiting') {
    return el('td', { class: 'mx-muted' }, '')
  }
  if (step.state === 'running') {
    return el('td', { class: 'mx-muted cc-running' }, 'asking…')
  }
  if (step.state !== 'done') {
    return el(
      'td',
      { class: 'mx-muted' },
      step.state === 'failed' ? 'failed' : 'skipped',
    )
  }

  const answer = step.result.answers.find((a) => a.id === fact.id)
  return el(
    'td',
    { title: `${answer.question}\n→ ${answer.answer || '(no answer)'}` },
    answer.kept
      ? el('span', { class: 'mx-good' }, '✓ kept')
      : el('span', { class: 'mx-bad' }, '✗ lost'),
    // The model often wraps a value in Markdown backticks; show the value alone.
    el(
      'span',
      { class: 'cc-answer mx-muted' },
      (answer.answer || '(no answer)').replace(/^`+|`+$/g, ''),
    ),
  )
}

function renderFacts() {
  document
    .getElementById('facts')
    .replaceChildren(
      ...info.facts.map((fact) =>
        el(
          'tr',
          {},
          el('td', {}, fact.label),
          ...[0, 1, 2, 3].map((round) => factCell(fact, round)),
        ),
      ),
    )
}

// ── The headline: which facts each round lost ──────────────────────────

const keptText = (p) =>
  `${p.answers.filter((a) => a.kept).length} of ${p.answers.length}`

function renderHeadline() {
  const box = document.getElementById('headline')
  const failed = steps.find((s) => s.state === 'failed')
  if (failed) {
    return box.replaceChildren(
      el(
        'div',
        { class: 'mx-callout mx-callout--warn' },
        el('span', { class: 'mx-label' }, 'Result'),
        el(
          'p',
          {},
          `${failed.label} failed. The table shows the steps that finished. Open Requests for the error.`,
        ),
      ),
    )
  }

  const probes = [0, 1, 2, 3].map((round) => done('probe', round))
  if (steps.some((s) => s.state === 'running')) {
    const finished = steps.filter((s) => s.state === 'done').length
    return box.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        `Running: ${finished} of ${steps.length} requests done.`,
      ),
    )
  }
  if (!probes.every(Boolean)) {
    return box.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        `Press Run 3 rounds. ${steps.length} requests, under 1 cent with the default model.`,
      ),
    )
  }

  const [control, ...rounds] = probes
  const last = rounds.at(-1)
  box.replaceChildren(
    el(
      'div',
      { class: 'mx-callout' },
      el('span', { class: 'mx-label' }, 'Result'),
      el(
        'p',
        {},
        `After ${rounds.length} rounds, the summary keeps ${keptText(last)} facts. The full thread keeps ${keptText(control)}.`,
      ),
      el(
        'ul',
        { class: 'cc-lost' },
        ...rounds.map((p) => {
          const lost = p.answers.filter((a) => !a.kept).map((a) => a.label)
          return el(
            'li',
            {},
            `Round ${p.round}: ${keptText(p)} kept. `,
            lost.length
              ? el('span', { class: 'mx-bad' }, `Lost: ${lost.join(', ')}.`)
              : 'Nothing lost.',
          )
        }),
      ),
    ),
  )
}

// ── Summaries and steps ────────────────────────────────────────────────

// Each summary stays open: it is the text that the model reads in place of the thread.
function renderSummaries() {
  const list = [1, 2, 3].map((round) => done('compact', round)).filter(Boolean)
  document.getElementById('summaries').hidden = !list.length

  document
    .getElementById('summary-list')
    .replaceChildren(
      ...list.map((c) =>
        el(
          'div',
          { class: 'mx-stack cc-summary' },
          el(
            'span',
            { class: 'mx-label' },
            `Round ${c.round} summary · ${c.summaryTokens} tokens`,
          ),
          modelText(c.summary),
        ),
      ),
    )
}

// The fold's summary: how many requests, and what they cost so far.
function stepsTitle() {
  const usages = steps.filter((s) => s.result).map((s) => s.result.usage)
  if (!usages.length) {
    return `${steps.length} requests`
  }

  const cost = usages.every((u) => u.cost != null)
    ? formatCost(usages.reduce((sum, u) => sum + u.cost, 0))
    : 'cost unknown'
  const estimate = usages.some((u) => u.costSource === 'estimate')
    ? ' est.'
    : ''
  const count =
    usages.length === steps.length
      ? `${steps.length} requests`
      : `${usages.length} of ${steps.length} requests`

  return `${count} · ${cost}${estimate}`
}

function renderSteps() {
  document.getElementById('steps-title').textContent = stepsTitle()

  document.getElementById('steps').replaceChildren(
    ...steps.map((step) => {
      const r = step.result
      const status =
        step.state === 'failed'
          ? el('span', { class: 'mx-bad' }, `failed: ${step.error.message}`)
          : step.state === 'done'
            ? step.kind === 'compact'
              ? `${r.contextTokens} → ${r.summaryTokens} tokens`
              : `${r.answers.filter((a) => a.kept).length} of ${r.answers.length} facts kept`
            : el(
                'span',
                {
                  class: `mx-muted${step.state === 'running' ? ' cc-running' : ''}`,
                },
                step.state,
              )
      return el(
        'tr',
        { class: selected === step ? 'cc-selected' : '' },
        el('td', {}, step.label),
        el('td', {}, status),
        el('td', { class: 'mx-small' }, r ? usageText(r.usage) : ''),
        el('td', { class: 'num' }, r ? `${(r.ms / 1000).toFixed(1)} s` : ''),
        el(
          'td',
          {},
          r || step.state === 'failed'
            ? el(
                'button',
                {
                  class: 'mx-btn mx-btn--small',
                  type: 'button',
                  onclick: () => {
                    selected = step
                    render()
                  },
                },
                'Show',
              )
            : null,
        ),
      )
    }),
  )

  const detail = document.getElementById('detail')
  detail.hidden = !selected
  if (!selected) {
    return
  }

  detail.replaceChildren(
    el('span', { class: 'mx-label' }, selected.label),
    selected.result
      ? requestResponse(selected.result.request, selected.result.response)
      : el('p', { class: 'mx-bad' }, selected.error.message),
  )
}

function render() {
  renderHeadline()
  renderSizes()
  renderFacts()
  renderSummaries()
  renderSteps()
}

// ── Running the rounds: one call per step ──────────────────────────────

function plan() {
  const list = [{ kind: 'probe', round: 0, label: 'Full thread: questions' }]
  for (let round = 1; round <= info.rounds; round++) {
    list.push(
      { kind: 'compact', round, label: `Round ${round}: compact` },
      { kind: 'probe', round, label: `Round ${round}: questions` },
    )
  }

  return list.map((s) => ({
    ...s,
    state: 'waiting',
    result: null,
    error: null,
  }))
}

async function runStep(step, fn, input) {
  step.state = 'running'
  render()

  try {
    step.result = await call(fn, input)
    step.state = 'done'
  } catch (error) {
    if (error.missingKey) {
      showError(notice, error)
    }
    step.state = 'failed'
    step.error = error
  }

  render()
  return step.result
}

async function runAll() {
  if (button.disabled) {
    return
  }

  const prompt = promptBox.value.trim()
  if (!prompt) {
    return showError(
      notice,
      new Error(
        'The compaction prompt is empty. Press Reset to load compact.md.',
      ),
    )
  }
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  steps = plan()
  selected = null
  render()

  const base = picker.value()
  button.disabled = true
  button.textContent = 'Running…'

  try {
    // The control runs beside the rounds. Each probe runs beside the next compaction.
    const pending = [
      runStep(find('probe', 0), 'probeRound', { round: 0, ...base }),
    ]
    let previousSummary
    for (let round = 1; round <= info.rounds; round++) {
      const c = await runStep(find('compact', round), 'compactRound', {
        round,
        previousSummary,
        prompt,
        words,
        ...base,
      })
      if (!c) {
        for (const s of steps) {
          if (s.state === 'waiting') {
            s.state = `skipped: round ${round} failed`
          }
        }
        render()
        break
      }

      previousSummary = c.summary
      pending.push(
        runStep(find('probe', round), 'probeRound', {
          round,
          summary: c.summary,
          ...base,
        }),
      )
    }

    await Promise.all(pending)
  } finally {
    button.disabled = false
    button.textContent = 'Run 3 rounds'
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

promptBox.value = info.prompt
document.getElementById('prompt-reset').addEventListener('click', () => {
  promptBox.value = info.prompt
})

document.getElementById('words').append(
  ...info.words.choices.map((n) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(n === words),
        onclick: (event) => {
          words = n
          for (const b of event.currentTarget.parentElement.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
        },
      },
      String(n),
    ),
  ),
)

button.addEventListener('click', runAll)
steps = plan()
renderThread()
render()
