import {
  busy,
  call,
  codeBlock,
  debounce,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const { rules, checkpoints, maxRuns, maxParallel, efforts } =
  await call('setup')

const notice = document.getElementById('notice')
const goButton = document.getElementById('go')
const stopButton = document.getElementById('stop')
const runsInput = document.getElementById('runs')
const ruleSelect = document.getElementById('rule')
const maxSelect = document.getElementById('max')
const answersBox = document.getElementById('answer-groups')

// One color per batch. CSS variables keep them readable in both themes.
const COLORS = [
  'var(--mega-red)',
  'var(--mega-code-blue)',
  'var(--mx-ok)',
  'var(--mega-ink)',
  'var(--mega-zinc)',
  '#d97706',
]
// Fact mode draws three lines per batch, one per position.
const DASH = { start: '', middle: '7 5', end: '2 4' }
const WORDS = {
  rule: {
    yes: 'kept',
    no: 'broken',
    question: 'Does the model still follow the rule as the conversation grows?',
    axis: 'Runs that kept the rule',
    where: 'The rule is in the instructions of every request.',
  },
  fact: {
    yes: 'found',
    no: 'missed',
    question: 'Does the model still use a fact as the conversation grows?',
    axis: 'Runs that named the fact',
    where: 'Each size runs with the fact at the start, the middle and the end.',
  },
}

let mode = 'rule'
let effort = 'low'
let stopRequested = false
// Batches per mode. A batch: settings, model, and one entry per request.
const batches = { rule: [], fact: [] }
const selected = { rule: null, fact: null }
let batchCount = 0
// The estimate of the next run: requests, input tokens, cost and sizes.
let plan = null

const k = (tokens) => `${(tokens / 1000).toFixed(1)}k`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function settings() {
  const runs = Math.min(
    maxRuns,
    Math.max(1, Math.round(Number(runsInput.value) || 1)),
  )

  return {
    mode,
    rule: ruleSelect.value,
    withAnswers: document.getElementById('answers').checked,
    max: Number(maxSelect.value),
    runs,
    effort,
    ...picker.value(),
  }
}

// ── What one run does and costs ────────────────────────────────────────

/** "15 paid requests, 371k input tokens, about $0.08 est." */
function planText() {
  if (!plan) {
    return ''
  }
  const cost = plan.cost == null ? '.' : `, about ${formatCost(plan.cost)} est.`

  return `${plural(plan.requests, 'paid request')}, ${Math.round(plan.inputTokens / 1000)}k input tokens${cost}`
}

function showPlan() {
  const s = settings()
  const sizes = checkpoints.filter((c) => c <= s.max)

  document.getElementById('question').textContent = WORDS[mode].question
  document.getElementById('plan').textContent =
    `One run sends the conversation at ${plural(sizes.length, 'size')}, from ${sizes[0] / 1000}k to ${s.max / 1000}k tokens, ${plural(s.runs, 'time')} at each size. ${WORDS[mode].where}`
  document.getElementById('empty').textContent = `Press Run. ${planText()}`
  document.getElementById('series-sub').textContent =
    `Each run adds a line, so you can compare models and settings. Select a row to read its answers. Next run: ${planText()}`
  document.getElementById('advanced-count').textContent =
    `${mode === 'rule' ? 5 : 4} settings`
}

// The fold summary counts the pastes of the largest size.
function showWhatParts() {
  const pastes = plan ? Math.max(...plan.sizes.map((s) => s.pastes)) : null
  document.getElementById('what-parts').textContent = [
    'instructions',
    pastes
      ? `${plural(pastes, 'pasted output')} at the largest size`
      : 'pasted output',
    mode === 'fact' ? 'the fact' : null,
    'the question',
  ]
    .filter(Boolean)
    .join(', ')
}

const refreshEstimate = debounce(async () => {
  try {
    plan = await call('estimate', settings())
  } catch (error) {
    plan = null
    showError(notice, error)
  }

  showPlan()
  showWhatParts()
}, 120)

async function refreshPreview() {
  const p = await call('preview', { mode, rule: ruleSelect.value })
  document
    .getElementById('what')
    .replaceChildren(
      ...[
        el('span', { class: 'mx-label' }, 'Instructions'),
        withWrap(codeBlock(p.instructions)),
        el(
          'p',
          { class: 'mx-small mx-muted id-what-note' },
          'Then user messages with pasted output. A larger size adds more of them. The text is the same on every run. The first one:',
        ),
        withWrap(codeBlock(p.paste, 'md')),
        p.fact
          ? el(
              'p',
              { class: 'mx-small mx-muted id-what-note' },
              'One more user message, at the start, the middle or the end:',
            )
          : null,
        p.fact ? codeBlock(p.fact) : null,
        el(
          'p',
          { class: 'mx-small mx-muted id-what-note' },
          'Last, the question:',
        ),
        withWrap(codeBlock(p.question)),
      ].filter(Boolean),
    )

  showWhatParts()
}

function withWrap(block) {
  block.setAttribute('data-wrap', '')
  return block
}

// ── The chart ──────────────────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg'
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value != null) {
      node.setAttribute(name, value)
    }
  }
  node.append(...children.filter((c) => c != null))

  return node
}

/** The points of one line: per size, how many runs passed the check. */
function pointsOf(batch, position) {
  return batch.sizes.map((size) => {
    const runs = batch.entries.filter(
      (e) =>
        e.job.target === size.target &&
        (!position || e.job.position === position) &&
        e.run,
    )
    const checked = runs.filter((e) => e.run.kept !== null)

    return {
      target: size.target,
      tokens: size.tokens,
      kept: checked.filter((e) => e.run.kept).length,
      checked: checked.length,
      position,
    }
  })
}

function linesOf(batch) {
  return batch.mode === 'fact'
    ? ['start', 'middle', 'end'].map((p) => ({
        position: p,
        points: pointsOf(batch, p),
      }))
    : [{ position: null, points: pointsOf(batch) }]
}

function drawChart() {
  const list = batches[mode]
  if (!list.length) {
    return document.getElementById('chart').replaceChildren()
  }

  const W = 640,
    H = 270,
    left = 52,
    right = 16,
    top = 14,
    bottom = 44
  const shown = Math.max(...list.flatMap((b) => b.sizes.map((s) => s.target)))
  const ticks = checkpoints.filter((c) => c <= shown)
  const lo = Math.log2(ticks[0] * 0.85),
    hi = Math.log2(ticks.at(-1) * 1.1)
  const x = (tokens) =>
    left + ((Math.log2(tokens) - lo) / (hi - lo)) * (W - left - right)
  const y = (share) => top + (1 - share) * (H - top - bottom)

  const grid = [0, 0.25, 0.5, 0.75, 1].map((s) =>
    svg(
      'g',
      {},
      svg('line', {
        x1: left,
        x2: W - right,
        y1: y(s),
        y2: y(s),
        class: s === 0 ? 'id-axis' : 'id-grid',
      }),
      s % 0.5 === 0
        ? svg(
            'text',
            {
              x: left - 8,
              y: y(s) + 4,
              'text-anchor': 'end',
              class: 'id-tick',
            },
            `${s * 100}%`,
          )
        : null,
    ),
  )

  const xTicks = ticks.map((t) =>
    svg(
      'text',
      {
        x: x(t),
        y: H - bottom + 18,
        'text-anchor': 'middle',
        class: 'id-tick',
      },
      `${t / 1000}k`,
    ),
  )

  const labels = [
    svg(
      'text',
      {
        x: (left + W - right) / 2,
        y: H - 6,
        'text-anchor': 'middle',
        class: 'id-axis-label',
      },
      'Context size in tokens (log scale)',
    ),
    svg(
      'text',
      {
        x: 12,
        y: (top + H - bottom) / 2,
        'text-anchor': 'middle',
        class: 'id-axis-label',
        transform: `rotate(-90 12 ${(top + H - bottom) / 2})`,
      },
      WORDS[mode].axis,
    ),
  ]

  const series = list.flatMap((batch) =>
    linesOf(batch).map(({ position, points }) => {
      const done = points.filter((p) => p.checked > 0)
      const style = `stroke: ${batch.color}`
      const faded =
        selected[mode] && selected[mode] !== batch.id ? ' is-faded' : ''
      return svg(
        'g',
        { class: `id-series${faded}` },
        done.length > 1
          ? svg('polyline', {
              points: done
                .map((p) => `${x(p.tokens)},${y(p.kept / p.checked)}`)
                .join(' '),
              class: 'id-line',
              style,
              'stroke-dasharray': position ? DASH[position] || null : null,
            })
          : null,
        ...done.map((p) =>
          svg(
            'circle',
            {
              cx: x(p.tokens),
              cy: y(p.kept / p.checked),
              r: 4.5,
              class: 'id-dot',
              style: `${style}; fill: ${batch.color}`,
            },
            svg(
              'title',
              {},
              `${batch.model}${position ? ` · fact at the ${position}` : ''} · ${k(p.tokens)} tokens: ${p.kept} of ${p.checked} ${WORDS[mode].yes}`,
            ),
          ),
        ),
      )
    }),
  )

  document
    .getElementById('chart')
    .replaceChildren(...grid, ...xTicks, ...labels, ...series)
}

// ── The headline, the meaning, the lines, the answers ──────────────────

const isDone = (batch) => batch.entries.every((e) => e.run || e.error)

/** The finding of one batch, with its numbers. Computed from the answers. */
function headlineOf(batch) {
  const checked = batch.entries.filter((e) => e.run && e.run.kept !== null)
  const passed = checked.filter((e) => e.run.kept).length
  const cut = batch.entries.filter((e) => e.run && e.run.kept === null).length
  const cutNote = cut
    ? ` ${plural(cut, 'answer')} hit the output limit and ${cut === 1 ? 'is' : 'are'} not counted.`
    : ''

  if (!checked.length) {
    return { warn: true, text: `No answer was checked.${cutNote}` }
  }

  const sized = batch.sizes
    .map((size) => ({
      size,
      list: checked.filter((e) => e.job.target === size.target),
    }))
    .filter((s) => s.list.length)
  const first = sized[0]
  const last = sized.at(-1)
  const range =
    first === last
      ? `at ${k(first.size.tokens)} tokens`
      : `from ${k(first.size.tokens)} to ${k(last.size.tokens)} tokens`

  if (batch.mode === 'fact') {
    if (passed === checked.length) {
      return {
        warn: false,
        text: `The model named heron-7 in all ${checked.length} runs, at every position, ${range}.${cutNote}`,
      }
    }
    const missed = (position) =>
      checked.filter((e) => e.job.position === position && !e.run.kept).length
    return {
      warn: true,
      text: `The model named heron-7 in ${passed} of ${checked.length} runs. Misses by position: start ${missed('start')}, middle ${missed('middle')}, end ${missed('end')}.${cutNote}`,
    }
  }

  if (passed === checked.length) {
    return {
      warn: false,
      text: `The model kept the rule in all ${checked.length} runs, ${range}.${cutNote}`,
    }
  }

  const share = (s) =>
    `${s.list.filter((e) => e.run.kept).length} of ${s.list.length} runs at ${k(s.size.tokens)} tokens`
  const where =
    first === last ? share(first) : `${share(first)}, and in ${share(last)}`

  return {
    warn: true,
    text: `The model kept the rule in ${where}. It broke the rule in ${checked.length - passed} of ${checked.length} runs.${cutNote}`,
  }
}

function drawHeadline(batch) {
  const box = document.getElementById('headline')
  box.hidden = !batch
  if (!batch) {
    return box.replaceChildren()
  }

  if (!isDone(batch)) {
    const finished = batch.entries.filter((e) => e.run || e.error).length
    return box.replaceChildren(
      el(
        'div',
        { class: 'mx-callout' },
        el(
          'p',
          {},
          `${finished} of ${plural(batch.entries.length, 'answer')} received. The chart grows as answers arrive.`,
        ),
      ),
    )
  }

  const { warn, text } = headlineOf(batch)
  box.replaceChildren(
    el(
      'div',
      { class: `mx-callout${warn ? ' mx-callout--warn' : ''}` },
      el('p', {}, text),
    ),
  )
}

const refreshMeaning = debounce(async () => {
  const box = document.getElementById('meaning')
  const batch = batches[mode].find((b) => b.id === selected[mode])
  if (!batch || !isDone(batch)) {
    box.hidden = true
    return
  }

  const points = linesOf(batch).flatMap((l) => l.points)
  const usage = totalUsage(batch)
  let text = ''
  try {
    text = (await call('meaning', { mode, points })).text
  } catch {}

  box.textContent = [text, usage ? usageText(usage) : null]
    .filter(Boolean)
    .join(' ')
  box.hidden = box.textContent === ''
}, 150)

function totalUsage(batch) {
  let total = null
  for (const e of batch.entries) {
    if (!e.run) {
      continue
    }
    const u = e.run.usage
    total = total
      ? {
          inputTokens: total.inputTokens + u.inputTokens,
          outputTokens: total.outputTokens + u.outputTokens,
          reasoningTokens: total.reasoningTokens + u.reasoningTokens,
          cost:
            total.cost == null || u.cost == null ? null : total.cost + u.cost,
          costSource:
            total.costSource === 'estimate' || u.costSource === 'estimate'
              ? 'estimate'
              : u.costSource,
        }
      : { ...u }
  }

  return total
}

function drawLines() {
  const list = batches[mode]
  document.getElementById('series-box').hidden = !list.length
  document
    .getElementById('series-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, ''),
        el('th', {}, 'Model'),
        mode === 'rule' ? el('th', {}, 'Rule') : null,
        el('th', {}, 'Effort'),
        mode === 'rule' ? el('th', {}, 'Earlier answers') : null,
        el('th', {}, 'Result'),
        el('th', {}, ''),
      ),
    )

  document.getElementById('series-rows').replaceChildren(
    ...list.map((batch) => {
      const finished = batch.entries.filter((e) => e.run || e.error).length
      const failed = batch.entries.filter((e) => e.error).length
      const checked = batch.entries.filter((e) => e.run && e.run.kept !== null)
      const status =
        finished < batch.entries.length
          ? `${finished} of ${batch.entries.length} answers…`
          : [
              `${checked.filter((e) => e.run.kept).length} of ${checked.length} ${WORDS[batch.mode].yes}`,
              failed ? `${failed} failed` : null,
            ]
              .filter(Boolean)
              .join(' · ')

      const select = () => {
        selected[mode] = batch.id
        render()
      }

      return el(
        'tr',
        {
          class: `id-row${selected[mode] === batch.id ? ' is-selected' : ''}`,
          tabindex: '0',
          onclick: select,
          onkeydown: (e) => {
            if (e.key === 'Enter') {
              select()
            }
          },
        },
        el(
          'td',
          {},
          el('span', {
            class: 'id-swatch',
            style: { background: batch.color },
          }),
        ),
        el('td', {}, el('code', {}, batch.model)),
        mode === 'rule' ? el('td', {}, batch.ruleLabel) : null,
        el('td', {}, batch.effort),
        mode === 'rule'
          ? el('td', {}, batch.withAnswers ? 'follow the rule' : 'none')
          : null,
        el(
          'td',
          { class: `mx-small ${failed ? 'mx-bad' : 'mx-muted'}` },
          status,
        ),
        el(
          'td',
          {},
          el(
            'button',
            {
              class: 'mx-btn mx-btn--small',
              type: 'button',
              title: 'Remove this line',
              'aria-label': 'Remove this line',
              disabled: finished < batch.entries.length,
              onclick: (event) => {
                event.stopPropagation()
                batches[mode] = batches[mode].filter((b) => b !== batch)
                if (selected[mode] === batch.id) {
                  selected[mode] = batches[mode].at(-1)?.id ?? null
                }
                render()
              },
            },
            '×',
          ),
        ),
      )
    }),
  )
}

function markOf(entry) {
  if (entry.error) {
    return el('span', { class: 'mx-bad' }, 'failed')
  }
  if (!entry.run) {
    return el('span', { class: 'mx-muted' }, 'waiting')
  }
  if (entry.run.kept === null) {
    return el('span', { class: 'mx-muted' }, 'cut')
  }
  return entry.run.kept
    ? el('span', { class: 'mx-good' }, WORDS[mode].yes)
    : el('span', { class: 'mx-bad' }, WORDS[mode].no)
}

function answerView(entry, n) {
  const head = el(
    'div',
    { class: 'mx-spread' },
    el(
      'span',
      { class: 'id-run-head' },
      el('b', {}, `Run ${n}`),
      ' · ',
      markOf(entry),
      entry.run
        ? el('span', { class: 'mx-muted' }, ` · ${entry.run.reason}`)
        : null,
    ),
    entry.run
      ? el(
          'span',
          { class: 'mx-small mx-muted' },
          `${usageText(entry.run.usage)} · ${entry.run.ms} ms`,
        )
      : null,
  )

  if (entry.error) {
    return el(
      'div',
      { class: 'id-answer' },
      head,
      el('p', { class: 'mx-small mx-bad' }, entry.error),
    )
  }

  if (!entry.run) {
    return el('div', { class: 'id-answer' }, head)
  }

  return el(
    'div',
    { class: 'id-answer' },
    head,
    modelText(entry.run.text || '(no text)'),
  )
}

function rawView(run, n) {
  const details = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `run ${n} · long texts shortened`,
      ),
    ),
  )

  details.addEventListener('toggle', () => {
    if (details.open && details.children.length === 1) {
      details.append(requestResponse(run.request, run.response))
    }
  })

  return details
}

// Keeps open groups open while answers arrive.
const openGroups = new Set()

function drawAnswers() {
  const batch = batches[mode].find((b) => b.id === selected[mode])
  document.getElementById('answers-box').hidden = !batch
  if (!batch) {
    return answersBox.replaceChildren()
  }

  document.getElementById('answers-title').textContent =
    `Answers of ${batch.model}`

  const groups = []
  for (const size of batch.sizes) {
    for (const position of batch.mode === 'fact'
      ? ['start', 'middle', 'end']
      : [null]) {
      const entries = batch.entries.filter(
        (e) =>
          e.job.target === size.target &&
          (!position || e.job.position === position),
      )
      const key = `${batch.id}:${size.target}:${position}`
      const first = entries.find((e) => e.run)
      // The body is built when the group opens: code blocks in it ask the viewer for colors.
      const body = el('div', { class: 'mx-stack id-group-body' })
      let filled = false
      const fill = () => {
        if (filled) {
          return
        }
        filled = true
        body.replaceChildren(
          ...entries.map((e, i) => answerView(e, i + 1)),
          ...(first ? [rawView(first.run, entries.indexOf(first) + 1)] : []),
        )
      }

      const details = el(
        'details',
        { class: 'mx-details id-group', open: openGroups.has(key) },
        el(
          'summary',
          {},
          el('span', { class: 'id-size' }, `${k(size.tokens)} tokens`),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            [
              position ? `fact at the ${position}` : null,
              plural(entries.length, 'answer'),
            ]
              .filter(Boolean)
              .join(' · '),
          ),
          el(
            'span',
            { class: 'id-marks mx-small' },
            ...entries.flatMap((e, i) => [i ? ' · ' : null, markOf(e)]),
          ),
        ),
        body,
      )

      if (details.open) {
        fill()
      }
      details.addEventListener('toggle', () => {
        if (details.open) {
          openGroups.add(key)
          fill()
        } else {
          openGroups.delete(key)
        }
      })

      groups.push(details)
    }
  }

  answersBox.replaceChildren(...groups)
}

function render() {
  const any = batches[mode].length > 0
  document.getElementById('styles').hidden = mode !== 'fact' || !any
  document.getElementById('empty').hidden = any
  document.getElementById('chart-box').hidden = !any

  showPlan()
  drawHeadline(batches[mode].find((b) => b.id === selected[mode]))
  drawChart()
  drawLines()
  drawAnswers()
  refreshMeaning()
}

// ── Running a batch ────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  const s = settings()
  runsInput.value = String(s.runs)
  notice.replaceChildren()

  try {
    plan = await call('estimate', s)
  } catch (error) {
    return showError(notice, error)
  }

  const positions = s.mode === 'fact' ? ['start', 'middle', 'end'] : [null]
  const entries = []
  for (const size of plan.sizes) {
    for (const position of positions) {
      for (let r = 0; r < s.runs; r++) {
        entries.push({
          job: { target: size.target, position },
          run: null,
          error: null,
        })
      }
    }
  }

  const provider = picker.providers().find((p) => p.id === s.provider)
  const batch = {
    id: ++batchCount,
    mode: s.mode,
    color: COLORS[(batchCount - 1) % COLORS.length],
    model: s.model || provider?.model || 'default',
    effort: s.effort,
    withAnswers: s.mode === 'rule' && s.withAnswers,
    ruleLabel: rules.find((r) => r.id === s.rule)?.label ?? s.rule,
    sizes: plan.sizes,
    entries,
  }

  batches[s.mode].push(batch)
  selected[s.mode] = batch.id
  render()

  // One call per request, at most maxParallel at once. The chart grows as answers arrive.
  stopRequested = false
  stopButton.hidden = false
  let next = 0
  async function worker() {
    while (next < entries.length && !stopRequested) {
      const entry = entries[next++]
      try {
        entry.run = await call('run', {
          ...s,
          target: entry.job.target,
          position: entry.job.position,
        })
        batch.model = entry.run.model
      } catch (error) {
        entry.error = error.message
        if (error.missingKey) {
          showError(notice, error)
        }
      }
      if (mode === batch.mode) {
        render()
      }
    }
  }

  try {
    await busy(goButton, 'Running…', () =>
      Promise.all(
        Array.from({ length: Math.min(maxParallel, entries.length) }, worker),
      ),
    )
  } finally {
    stopButton.hidden = true
    // Requests that never started are dropped, so the line shows only real answers.
    batch.entries = entries.filter((e) => e.run || e.error)
    if (mode === batch.mode) {
      render()
    }
  }
}

// ── Settings ───────────────────────────────────────────────────────────

function setMode(value) {
  mode = value

  for (const b of document.getElementById('modes').children) {
    b.setAttribute('aria-pressed', String(b.dataset.value === value))
  }
  for (const field of document.querySelectorAll('[data-mode]')) {
    field.hidden = field.dataset.mode !== value
  }

  refreshEstimate()
  void refreshPreview()
  render()
}

function setEffort(value) {
  effort = value

  for (const b of document.getElementById('efforts').children) {
    b.setAttribute('aria-pressed', String(b.dataset.effort === value))
  }

  refreshEstimate()
}

function showRule() {
  document.getElementById('rule-hint').textContent =
    rules.find((r) => r.id === ruleSelect.value)?.instruction ?? ''
}

const picker = await providerPicker(document.getElementById('picker'), {
  onChange: refreshEstimate,
})
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('modes').append(
  ...[
    ['rule', 'Rule'],
    ['fact', 'Fact'],
  ].map(([value, label]) =>
    // data-value, not data-mode: setMode() hides every [data-mode] element of the other mode.
    el(
      'button',
      { type: 'button', 'data-value': value, onclick: () => setMode(value) },
      label,
    ),
  ),
)

document.getElementById('efforts').append(
  ...efforts.map((value) =>
    el(
      'button',
      {
        type: 'button',
        'data-effort': value,
        onclick: () => setEffort(value),
      },
      value,
    ),
  ),
)

ruleSelect.append(...rules.map((r) => el('option', { value: r.id }, r.label)))
// The smallest size always runs; the user picks the largest.
maxSelect.append(
  ...checkpoints
    .slice(1)
    .map((c) => el('option', { value: String(c) }, `${c / 1000}k tokens`)),
)
maxSelect.value = String(checkpoints.at(-1))
runsInput.max = String(maxRuns)

ruleSelect.addEventListener('change', () => {
  showRule()
  refreshEstimate()
  void refreshPreview()
})

for (const input of [
  maxSelect,
  runsInput,
  document.getElementById('answers'),
]) {
  input.addEventListener('input', () => {
    showPlan()
    refreshEstimate()
  })
}

goButton.addEventListener('click', start)
stopButton.addEventListener('click', () => {
  stopRequested = true
})

showRule()
setEffort('low')
setMode('rule')
