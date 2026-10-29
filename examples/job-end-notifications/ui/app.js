import {
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const runButton = document.getElementById('run')
const runsBox = document.getElementById('runs')
const notice = document.getElementById('notice')
let batch = 0
// One entry per trial: { state: 'running' | 'done' | 'failed', data, error }.
let trials = []

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const number = (n) => Math.round(n).toLocaleString('en-US')
const one = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const modeOf = (id) => setup.modes.find((m) => m.id === id)
const jobIndex = (id) => setup.jobs.findIndex((j) => j.id === id)
const cost = (u) =>
  u.cost == null
    ? '—'
    : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`

// ── The inputs ─────────────────────────────────────────────────────────

const badge = (i, extra = '') =>
  el('span', { class: `je-num ${extra}` }, String(i + 1))

document.getElementById('jobs-note').textContent =
  `${plural(setup.jobs.length, 'job')}, one crash · the Worker instructions`
document.getElementById('jobs').append(
  el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Job'),
          el('th', {}, 'Task'),
          el('th', { class: 'num' }, 'Ends at tick'),
          el('th', {}, 'Known end'),
        ),
      ),
      el(
        'tbody',
        {},
        setup.jobs.map((job, i) =>
          el(
            'tr',
            {},
            el(
              'td',
              { class: 'je-nowrap' },
              badge(i),
              ' ',
              el('code', {}, job.id),
            ),
            el('td', {}, job.title),
            el('td', { class: 'num' }, String(job.endsAt)),
            el(
              'td',
              {},
              job.crash
                ? el('span', { class: 'mx-bad' }, `crashes: ${job.crash}`)
                : ['done, ', el('code', {}, job.answer)],
            ),
          ),
        ),
      ),
    ),
  ),
  el('span', { class: 'mx-label' }, 'Worker instructions'),
  codeBlock(setup.workerInstructions),
  ...setup.jobs.map((job) =>
    el(
      'div',
      { class: 'mx-stack' },
      el('span', { class: 'mx-label' }, job.id),
      el('p', { class: 'mx-small je-task' }, job.task),
      codeBlock(job.input),
    ),
  ),
)

document.getElementById('setup-note').textContent =
  `${setup.modes.length} modes · instructions, tools, status report schema`
document
  .getElementById('setup')
  .append(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'mx-stack' },
        el('span', { class: 'mx-label' }, `${m.label}: instructions`),
        codeBlock(m.instructions),
        el('span', { class: 'mx-label' }, `${m.label}: first message`),
        codeBlock(m.start),
        el('span', { class: 'mx-label' }, `${m.label}: tools`),
        codeBlock(prettyJson(m.tools), 'json'),
      ),
    ),
    el('span', { class: 'mx-label' }, 'Status report schema'),
    codeBlock(prettyJson(setup.schema), 'json'),
  )

// ── The result ─────────────────────────────────────────────────────────

const doneTrials = () =>
  trials.filter((t) => t.state === 'done').map((t) => t.data)

async function renderResult() {
  const done = doneTrials()
  document.getElementById('result').hidden = !done.length
  if (!done.length) {
    return
  }

  const { summaries, meaning } = await call('summary', {
    runs: done.flatMap((t) => t.runs.map((r) => r.numbers)),
  })

  document
    .getElementById('summary')
    .replaceChildren(
      ...summaries.map((s) =>
        el(
          'tr',
          {},
          el('td', {}, el('b', {}, modeOf(s.mode).label)),
          el(
            'td',
            { class: 'num' },
            one(s.requests.mean),
            s.requests.min === s.requests.max
              ? null
              : el(
                  'span',
                  { class: 'mx-muted mx-small' },
                  ` ${s.requests.min}–${s.requests.max}`,
                ),
          ),
          el('td', { class: 'num' }, number(s.inputTokens.mean)),
          el(
            'td',
            {},
            s.delay.mean === null
              ? 'saw no end'
              : s.delay.max === 0
                ? '0'
                : `${one(s.delay.mean)} on average, ${s.delay.max} at most`,
            s.missed
              ? el('span', { class: 'mx-bad' }, `, ${s.missed} not seen`)
              : null,
          ),
          el(
            'td',
            { class: `num ${s.correct === s.total ? 'mx-good' : 'mx-bad'}` },
            `${s.correct} of ${s.total}`,
          ),
          el('td', { class: 'je-nowrap' }, cost(s.usage)),
        ),
      ),
    )

  const running = trials.some((t) => t.state === 'running')
  document
    .getElementById('headline')
    .replaceChildren(
      el('strong', {}, meaning.finding),
      ...[meaning.detail, running ? 'More runs are on the way.' : null]
        .filter(Boolean)
        .map((text) => ` ${text}`),
    )
}

// ── The clock ──────────────────────────────────────────────────────────

const at = (tick) => ({ '--at': String(tick) })

function guides() {
  // A dashed line at each job's end, through every lane.
  return setup.jobs.map((job) =>
    el('span', { class: 'je-guide', style: at(job.endsAt) }),
  )
}

function jobLane(job, i, max) {
  return el(
    'div',
    { class: 'je-lane is-job' },
    el('div', { class: 'je-lane-label' }, badge(i), el('code', {}, job.id)),
    el(
      'div',
      { class: 'je-track' },
      guides(),
      el('span', { class: 'je-bar', style: at(job.endsAt) }),
      el(
        'span',
        {
          class: `je-end ${job.crash ? 'is-crash' : 'is-done'}`,
          style: at(job.endsAt),
          title: job.crash
            ? `crashed at tick ${job.endsAt}`
            : `done at tick ${job.endsAt}`,
        },
        job.crash ? '✗' : '✓',
      ),
    ),
  )
}

function runLane(run, label, max) {
  // Requests at the same tick share one dot, with their count.
  const byTick = new Map()
  for (const step of run.steps) {
    byTick.set(step.tick, [...(byTick.get(step.tick) ?? []), step])
  }

  const dots = [...byTick].map(([tick, steps]) =>
    el(
      'span',
      {
        class: 'je-dot',
        style: at(tick),
        title: `${plural(steps.length, 'request')} at tick ${tick}: ${steps.map((s) => (s.calls.length ? s.calls.map((c) => c.name).join(', ') : 'status report')).join(' · ')}`,
      },
      steps.length > 1 ? String(steps.length) : '',
    ),
  )

  // The marks: when it first saw each end. The red line runs from the end to that tick.
  const seen = new Map()
  for (const r of run.reactions) {
    if (r.seenAt !== null) {
      seen.set(r.seenAt, [...(seen.get(r.seenAt) ?? []), r])
    }
  }

  const lines = run.reactions
    .filter((r) => r.delay > 0)
    .map((r) =>
      el('span', {
        class: 'je-late',
        style: {
          '--from': String(r.endsAt),
          '--to': String(r.seenAt),
          '--row': String(jobIndex(r.jobId)),
        },
      }),
    )

  const marks = [...seen].map(([tick, list]) =>
    el(
      'span',
      {
        class: `je-seen${list.some((r) => r.delay > 0) ? ' is-late' : ''}`,
        style: at(tick),
        title: list
          .map((r) => `${r.jobId}: ended at ${r.endsAt}, seen at ${r.seenAt}`)
          .join('\n'),
      },
      list.map((r) => String(jobIndex(r.jobId) + 1)).join(' '),
    ),
  )

  return el(
    'div',
    { class: 'je-lane' },
    el('div', { class: 'je-lane-label' }, label),
    el('div', { class: 'je-track is-run' }, guides(), lines, dots, marks),
  )
}

function renderClock() {
  const done = doneTrials()
  document.getElementById('clock-box').hidden = !done.length
  if (!done.length) {
    return
  }

  const ticks = done.flatMap((t) =>
    t.runs.flatMap((r) => r.steps.map((s) => s.tick)),
  )
  const max = Math.max(12, ...ticks, ...setup.jobs.map((j) => j.endsAt)) + 1
  const lanes = setup.modes.flatMap((m) => [
    el('div', { class: 'je-group' }, modeOf(m.id).label),
    ...done.map((t) =>
      runLane(
        t.runs.find((r) => r.mode === m.id),
        `run ${trials.findIndex((x) => x.data === t) + 1}`,
        max,
      ),
    ),
  ])

  const axis = el(
    'div',
    { class: 'je-lane is-axis' },
    el('div', { class: 'je-lane-label mx-small mx-muted' }, 'tick'),
    el(
      'div',
      { class: 'je-track' },
      Array.from({ length: max }, (_, tick) =>
        tick % (max > 24 ? 5 : 2) === 0
          ? el('span', { class: 'je-tick', style: at(tick) }, String(tick))
          : null,
      ),
    ),
  )

  document
    .getElementById('clock')
    .replaceChildren(
      el(
        'div',
        { class: 'je-chart', style: { '--max': String(max) } },
        ...setup.jobs.map((job, i) => jobLane(job, i, max)),
        ...lanes,
        axis,
      ),
    )
}

// ── Run by run ─────────────────────────────────────────────────────────

function reportTable(run) {
  const reaction = (id) => run.reactions.find((r) => r.jobId === id)

  return el(
    'table',
    { class: 'mx-table je-report' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Job'),
        el('th', {}, 'Reported'),
        el('th', { class: 'num' }, 'Ticks late'),
      ),
    ),
    el(
      'tbody',
      {},
      run.scores.map((s) => {
        const r = reaction(s.jobId)

        return el(
          'tr',
          {},
          el(
            'td',
            { class: 'je-nowrap' },
            badge(jobIndex(s.jobId)),
            ' ',
            el('code', {}, s.jobId),
          ),
          el(
            'td',
            {},
            el(
              'span',
              { class: s.correct ? 'mx-good' : 'mx-bad' },
              `${s.correct ? '✓' : '✗'} ${s.status ?? 'missing'}`,
            ),
            s.status === 'crashed'
              ? el('div', { class: 'mx-small mx-muted' }, s.reason)
              : s.result
                ? el('div', {}, el('code', {}, s.result))
                : null,
            s.correct ? null : el('div', { class: 'mx-small mx-bad' }, s.note),
          ),
          el(
            'td',
            { class: `num ${r.delay ? 'mx-bad' : ''}` },
            r.delay === null ? 'not seen' : String(r.delay),
          ),
        )
      }),
    ),
  )
}

function stepView(step) {
  let text = null
  if (step.text) {
    try {
      text = modelText(
        `\`\`\`json\n${prettyJson(JSON.parse(step.text))}\n\`\`\``,
      )
    } catch {
      text = modelText(step.text)
    }
  }

  return el(
    'div',
    { class: 'mx-stack je-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Request ${step.number} · tick ${step.tick} · ${step.calls.length ? plural(step.calls.length, 'tool call') : 'status report'}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.woke
      ? el(
          'p',
          { class: 'je-woke' },
          el('span', { class: 'mx-label' }, 'Harness message'),
          ' ',
          el('code', {}, step.woke),
        )
      : null,
    step.calls.map((c) =>
      el(
        'div',
        { class: 'je-call' },
        el(
          'div',
          {},
          el('code', { class: 'je-call-name' }, c.name),
          ' ',
          el('code', { class: 'mx-muted' }, c.arguments),
        ),
        el('span', { class: 'mx-label' }, 'Tool result'),
        codeBlock(prettyJson(JSON.parse(c.output)), 'json'),
      ),
    ),
    text,
    requestResponse(step.request, step.response),
  )
}

function modeColumn(run) {
  return el(
    'div',
    { class: 'mx-stack je-col' },
    el(
      'div',
      { class: 'je-col-head' },
      el('b', {}, modeOf(run.mode).label),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(run.steps.length, 'request')} · ${usageText(run.usage)}`,
      ),
    ),
    run.end === 'step_limit' || run.reportErrors.length
      ? el('p', { class: 'mx-small mx-bad' }, run.reportErrors.join(' '))
      : null,
    reportTable(run),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Requests'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `${run.steps.length} · tool results, status reports, raw JSON`,
        ),
      ),
      el('div', { class: 'je-pad mx-stack' }, run.steps.map(stepView)),
    ),
  )
}

function workersLine(data) {
  return el(
    'p',
    { class: 'mx-small je-workers' },
    el('span', { class: 'mx-label' }, 'Workers'),
    ' ',
    data.workers.flatMap((w, i) => [
      i ? ' · ' : null,
      el('code', {}, w.jobId),
      ' ',
      w.report === null
        ? el('span', { class: 'mx-bad' }, 'crashed, no report')
        : el('span', { class: w.right ? '' : 'mx-bad' }, w.report),
    ]),
  )
}

function renderCards() {
  const shown = trials.filter((t) => t.state !== 'idle')
  document.getElementById('runs-box').hidden = !shown.length

  document.getElementById('cards').replaceChildren(
    ...shown.map((t, i) =>
      el(
        'article',
        { class: 'mx-panel je-card' },
        el(
          'div',
          { class: 'mx-spread' },
          el('b', {}, `Run ${i + 1}`),
          t.state === 'done'
            ? el(
                'span',
                { class: 'mx-small mx-muted' },
                `All requests, Workers included: ${cost(t.data.usage)}`,
              )
            : null,
        ),
        t.state === 'running'
          ? el(
              'p',
              { class: 'mx-muted je-pulse' },
              'The Workers run, then both Coordinators…',
            )
          : null,
        t.state === 'failed'
          ? el('p', { class: 'mx-bad mx-small' }, t.error)
          : null,
        t.state === 'done'
          ? [
              workersLine(t.data),
              el(
                'div',
                { class: 'je-cols' },
                setup.modes.map((m) =>
                  modeColumn(t.data.runs.find((r) => r.mode === m.id)),
                ),
              ),
            ]
          : null,
      ),
    ),
  )
}

async function render() {
  renderClock()
  renderCards()
  await renderResult()
}

// ── Running ────────────────────────────────────────────────────────────

function renderEmpty() {
  const n = Number(runsBox.value)
  // One run is about 20 requests, about $0.0015 with the default model.
  document.getElementById('empty').textContent =
    `Press Run. ${plural(n, 'run')} per mode: about ${n * 20} requests, ${n < 5 ? 'under 1 cent' : 'about 1 cent'}.`
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const n = Number(runsBox.value)
  trials = Array.from({ length: n }, () => ({
    state: 'running',
    data: null,
    error: null,
  }))

  document.getElementById('empty').hidden = true
  runButton.disabled = true
  await render()

  try {
    // The runs go side by side; each one fills in when it is done.
    await Promise.all(
      trials.map(async (t) => {
        try {
          t.data = await call('trial', picker.value())
          t.state = 'done'
        } catch (error) {
          t.state = 'failed'
          t.error = error.message
          showError(notice, error)
        }

        if (id === batch) {
          await render()
        }
      }),
    )
  } finally {
    if (id === batch) {
      runButton.disabled = false
    }
  }
}

runsBox.append(
  ...Array.from({ length: setup.maxRuns }, (_, i) =>
    el('option', { value: String(i + 1), selected: i === 2 }, String(i + 1)),
  ),
)
runsBox.addEventListener('change', renderEmpty)
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
runButton.addEventListener('click', start)
renderEmpty()
