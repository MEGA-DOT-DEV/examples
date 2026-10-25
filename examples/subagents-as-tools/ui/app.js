import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const MODES = [
  { id: 'single', name: 'One agent' },
  { id: 'subagents', name: 'With subagents' },
]

const setup = await call('setup')
const runButton = document.getElementById('run')
const notice = document.getElementById('notice')
const subModel = document.getElementById('sub-model')
let effort = 'none'
let batch = 0
// Per mode: steps, the usage with subagents per step, the score, and the state.
let state = {}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const num = (n) => n.toLocaleString('en-US')
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
const chars = (text) => `${num(text.length)} characters`
const show = (id, visible = true) => {
  document.getElementById(id).hidden = !visible
}
// Plain names for the fields of the answer JSON.
const FIELD_LABELS = {
  vendor: 'Vendor',
  seats: 'Seats',
  price_per_seat_eur: 'Price per seat, EUR',
  notice_days: 'Notice period, days',
  term_end: 'Term end',
  data_region: 'Data region',
}

function sumUsage(list) {
  return list.reduce(
    (total, u) => ({
      inputTokens: total.inputTokens + u.inputTokens,
      outputTokens: total.outputTokens + u.outputTokens,
      reasoningTokens: total.reasoningTokens + u.reasoningTokens,
      cost: total.cost == null || u.cost == null ? null : total.cost + u.cost,
      costSource:
        total.costSource === 'estimate' || u.costSource === 'estimate'
          ? 'estimate'
          : u.costSource,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      costSource: null,
    },
  )
}

const largest = (s) =>
  Math.max(...s.steps.map((step) => step.usage.inputTokens))
const subagentCount = (s) =>
  s.steps.reduce((n, step) => n + step.calls.filter((c) => c.thread).length, 0)

// ── The chart: main-thread input tokens per request, both modes side by side ──

function renderChart() {
  const chart = document.getElementById('chart')
  const count = Math.max(
    ...MODES.map(
      (m) => state[m.id].steps.length + (state[m.id].pending ? 1 : 0),
    ),
    1,
  )
  const max = Math.max(
    ...MODES.flatMap((m) => state[m.id].steps.map((s) => s.usage.inputTokens)),
    1,
  )

  const groups = []
  for (let i = 0; i < count; i++) {
    const bars = MODES.map((m) => {
      const step = state[m.id].steps[i]
      if (step) {
        const n = step.usage.inputTokens
        return el(
          'div',
          {
            class: `sa-bar sa-bar--${m.id}`,
            style: { height: `${Math.max(1, (n / max) * 100)}%` },
            title: `${m.name}, request ${i + 1}: ${num(n)} input tokens`,
          },
          el('span', { class: 'sa-bar-num' }, num(n)),
        )
      }

      const waiting = state[m.id].pending && i === state[m.id].steps.length
      return el('div', {
        class: `sa-bar sa-bar--empty${waiting ? ' is-pending' : ''}`,
      })
    })
    groups.push(
      el(
        'div',
        { class: 'sa-group' },
        el('div', { class: 'sa-bars' }, bars),
        el('span', { class: 'sa-step-num' }, `request ${i + 1}`),
      ),
    )
  }

  chart.replaceChildren(...groups)
}

// ── The table: one row per measure, one column per mode ──

function renderTotals() {
  show('summary')
  const cells = MODES.map((m) => {
    const s = state[m.id]
    const all = sumUsage(s.withSubagents)
    return {
      main: s.error ? 'failed' : String(s.steps.length),
      subagents: String(subagentCount(s)),
      allIn: num(all.inputTokens),
      cost:
        all.cost == null
          ? '—'
          : `${formatCost(all.cost)}${all.costSource === 'estimate' ? ' est.' : ''}`,
    }
  })

  // The swatches in the head are the legend of the chart above.
  document.getElementById('totals-head').replaceChildren(
    el(
      'tr',
      {},
      el('th', {}, ''),
      ...MODES.map((m) =>
        el(
          'th',
          { class: 'num' },
          el(
            'span',
            { class: 'sa-mode' },
            el('i', {
              class: `sa-swatch sa-bar--${m.id}`,
              'aria-hidden': 'true',
            }),
            m.name,
          ),
        ),
      ),
    ),
  )

  const rows = [
    ['Main thread requests', 'main'],
    ['Subagents', 'subagents'],
    ['All threads, input tokens', 'allIn'],
    ['All threads, cost', 'cost'],
  ]
  document
    .getElementById('totals')
    .replaceChildren(
      ...rows.map(([label, key]) =>
        el(
          'tr',
          {},
          el('td', {}, label),
          ...cells.map((c) => el('td', { class: 'num' }, c[key])),
        ),
      ),
    )

  for (const m of MODES) {
    const s = state[m.id]
    const subs = subagentCount(s)
    document.getElementById(`trace-${m.id}-note`).textContent = [
      m.name.toLowerCase(),
      plural(s.steps.length, 'request'),
      subs ? plural(subs, 'subagent') : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }
}

/** The headline, the wrong values and the meaning, once both modes have an answer. */
function renderFinding() {
  const a = state.single
  const b = state.subagents
  if (!a.score || !b.score) {
    return
  }

  document.getElementById('headline-text').textContent =
    `The largest main thread request had ${num(largest(b))} input tokens with subagents and ${num(largest(a))} with one agent. ` +
    `Fields right: ${b.score.right} of ${b.score.total} with subagents, ${a.score.right} of ${a.score.total} with one agent.`

  show('headline')
  renderWrong()

  const meaning = document.getElementById('meaning')
  meaning.replaceChildren(
    'Each subagent read one contract in its own context. Only its answer came back to the main thread as a tool result.',
    el('br'),
    usageText(sumUsage(MODES.flatMap((m) => state[m.id].withSubagents))),
  )
  show('meaning')
}

/** The wrong values of each mode, with the correct value and the kind of mistake. */
function renderWrong() {
  show('wrong')
  for (const m of MODES) {
    const s = state[m.id].score
    document
      .getElementById(`wrong-${m.id}`)
      .replaceChildren(
        ...(s.wrong.length
          ? s.wrong.map((c) =>
              el(
                'li',
                { class: `sa-wrong-${c.kind}` },
                el(
                  'span',
                  { class: 'sa-wrong-head' },
                  el('b', {}, c.vendor),
                  el('span', {}, FIELD_LABELS[c.field] ?? c.field),
                ),
                el(
                  'span',
                  {},
                  el(
                    'span',
                    { class: 'mx-bad' },
                    c.got === null ? 'nothing' : JSON.stringify(c.got),
                  ),
                  ` instead of ${c.want}`,
                ),
                el(
                  'span',
                  { class: 'mx-small mx-muted' },
                  `${setup.errorLabels[c.kind]}${c.note ? `: ${c.note}` : ''}`,
                ),
              ),
            )
          : [el('li', { class: 'mx-good' }, 'All fields right.')]),
      )
  }
}

// ── The steps ──

function outputBlock(text) {
  let block
  try {
    block = codeBlock(prettyJson(JSON.parse(text)), 'json')
  } catch {
    block = codeBlock(text)
  }

  block.setAttribute('data-wrap', '')

  return block
}

/** The task a subagent got, from the arguments of its call. */
function taskOf(args) {
  try {
    return String(JSON.parse(args).task ?? args)
  } catch {
    return args
  }
}

// Every tool result is folded, with its size in the summary: one agent reads
// whole contracts, the main thread with subagents gets only short answers.
function callView(c) {
  const head = el(
    'div',
    { class: 'sa-call-head' },
    el('span', { class: 'sa-arrow', 'aria-hidden': 'true' }, '→'),
    el('code', { class: 'sa-call-name' }, c.name),
    c.thread
      ? el(
          'span',
          { class: 'sa-call-task', title: taskOf(c.arguments) },
          taskOf(c.arguments),
        )
      : el('code', { class: 'sa-call-args' }, c.arguments || '{}'),
  )

  const stopped = c.thread && c.thread.end !== 'answer'

  return el(
    'div',
    { class: `sa-call${c.error ? ' is-error' : ''}` },
    head,
    c.thread ? threadView(c.thread, taskOf(c.arguments)) : null,
    el(
      'details',
      { class: 'sa-result' },
      el(
        'summary',
        {},
        el(
          'span',
          { class: `mx-label${c.error || stopped ? ' mx-bad' : ''}` },
          c.error ? 'Tool error' : 'Tool result',
        ),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          [stopped ? 'the subagent stopped' : null, chars(c.output)]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
      outputBlock(c.output || '(no text)'),
    ),
  )
}

/** A subagent's own thread: the task it got, then its requests. */
function threadView(thread, task) {
  return el(
    'details',
    { class: 'sa-result' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Subagent thread'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(thread.steps.length, 'request')} · ${thread.model} · ${usageText(thread.usage)}`,
      ),
    ),
    el(
      'div',
      { class: 'sa-thread' },
      el(
        'span',
        { class: 'mx-label' },
        'Task: the first message in its context',
      ),
      outputBlock(task),
      el(
        'ol',
        { class: 'sa-trace' },
        thread.steps.map((s) => stepView(s, { nested: true })),
      ),
    ),
  )
}

/** The final answer, folded: its size says enough until a learner wants the values. */
function answerView(text) {
  let entries = null
  try {
    const parsed = JSON.parse(text)
    entries = Object.values(parsed).find(Array.isArray)?.length ?? null
  } catch {}

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Answer'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        entries == null
          ? chars(text)
          : `JSON, ${entries} ${entries === 1 ? 'entry' : 'entries'}`,
      ),
    ),
    outputBlock(text || '(no text)'),
  )
}

function stepView(step, { nested = false, end = null, stopText = null } = {}) {
  const answer = !step.calls.length
  const kind = answer ? 'answer' : plural(step.calls.length, 'tool call')

  return el(
    'li',
    { class: `sa-step${answer ? ' is-end' : ''}` },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label sa-kind' },
        `Request ${step.number} · ${kind}`,
      ),
      // The chart shows the main thread's input tokens; a subagent's requests show them here.
      el(
        'span',
        { class: 'mx-small mx-muted' },
        nested
          ? `${seconds(step.ms)} · ${usageText(step.usage)}`
          : seconds(step.ms),
      ),
    ),
    step.calls.map(callView),
    step.text && !answer
      ? el('p', { class: 'mx-small mx-muted sa-aside' }, step.text)
      : null,
    answer
      ? nested
        ? outputBlock(step.text || '(no text)')
        : answerView(step.text)
      : null,
    step.status === 'incomplete'
      ? el(
          'p',
          { class: 'mx-small mx-bad' },
          'The answer is cut: the model reached the output limit (max_output_tokens).',
        )
      : null,
    end === 'step_limit'
      ? el(
          'div',
          { class: 'mx-callout mx-callout--warn' },
          el('p', {}, stopText),
        )
      : null,
    el(
      'details',
      { class: 'mx-details sa-raw' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Request and response'),
        el('span', { class: 'mx-small mx-muted' }, `request ${step.number}`),
      ),
      el(
        'div',
        { class: 'sa-pad' },
        requestResponse(step.request, step.response),
      ),
    ),
  )
}

// ── Running both modes ──

async function runMode(mode, settings, id) {
  const trace = document.getElementById(`trace-${mode}`)
  const s = state[mode]
  const items = []

  for (let number = 1; number <= setup.maxSteps; number++) {
    s.pending = true
    const pending = el(
      'li',
      { class: 'sa-step is-pending' },
      el(
        'span',
        { class: 'mx-label' },
        mode === 'subagents' && number > 1
          ? `Request ${number} · waiting for the model and its subagents…`
          : `Request ${number} · waiting for the model…`,
      ),
    )
    trace.append(pending)
    renderChart()

    let result
    try {
      result = await call('step', { mode, items, number, ...settings })
    } catch (error) {
      if (id !== batch) {
        return
      }
      pending.remove()
      s.pending = false
      s.error = true
      showError(notice, error)
      break
    }

    if (id !== batch) {
      return
    }

    s.pending = false
    s.steps.push(result.step)
    s.withSubagents.push(result.usageWithSubagents)
    items.push(...result.added)
    if (result.end) {
      s.score = result.score
    }

    pending.replaceWith(
      stepView(result.step, { end: result.end, stopText: result.stopText }),
    )

    renderChart()
    renderTotals()

    if (result.end) {
      break
    }
  }

  renderChart()
  renderTotals()
  renderFinding()
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch

  state = Object.fromEntries(
    MODES.map((m) => [
      m.id,
      {
        steps: [],
        withSubagents: [],
        score: null,
        pending: false,
        error: false,
      },
    ]),
  )

  for (const m of MODES) {
    document.getElementById(`trace-${m.id}`).replaceChildren()
  }

  show('empty', false)
  for (const section of ['headline', 'summary', 'wrong', 'meaning']) {
    show(section, false)
  }
  show('chart-plate')
  show('traces')

  const settings = {
    ...picker.value(),
    effort,
    subagentModel: subModel.value.trim() || undefined,
  }

  await busy(runButton, 'Running…', () =>
    Promise.all(MODES.map((m) => runMode(m.id, settings, id))),
  )
}

// ── Setup ──

document.getElementById('task').textContent = setup.task
document.getElementById('contracts-note').textContent =
  `${setup.contracts.length} files in ${setup.folder}/, with the later changes in each`

document
  .getElementById('contracts')
  .replaceChildren(
    ...setup.contracts.map((c) =>
      el(
        'tr',
        {},
        el('td', {}, el('code', {}, c.file)),
        el('td', {}, c.vendor),
        el('td', { class: 'num' }, String(c.lines)),
        el(
          'td',
          { class: 'mx-small' },
          c.traps.length
            ? c.traps.join('; ')
            : el('span', { class: 'mx-muted' }, 'none'),
        ),
      ),
    ),
  )

document
  .getElementById('setup')
  .replaceChildren(
    el('span', { class: 'mx-label' }, 'One agent: instructions'),
    codeBlock(setup.instructions.single),
    el('span', { class: 'mx-label' }, 'One agent: tools'),
    codeBlock(prettyJson(setup.tools.single), 'json'),
    el(
      'span',
      { class: 'mx-label' },
      'With subagents, main thread: instructions',
    ),
    codeBlock(setup.instructions.main),
    el('span', { class: 'mx-label' }, 'With subagents, main thread: tools'),
    codeBlock(prettyJson(setup.tools.subagents), 'json'),
    el(
      'span',
      { class: 'mx-label' },
      'Each subagent: instructions (its only tool is read_file)',
    ),
    codeBlock(setup.instructions.subagent),
  )

const effortSeg = document.getElementById('efforts')
effortSeg.replaceChildren(
  ...setup.efforts.map((value) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(value === effort),
        onclick: (event) => {
          effort = value
          for (const b of effortSeg.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
        },
      },
      value,
    ),
  ),
)

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
runButton.addEventListener('click', start)
