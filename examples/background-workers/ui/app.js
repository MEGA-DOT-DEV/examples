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
const one = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const modeOf = (id) => setup.modes.find((m) => m.id === id)
const cost = (u) =>
  u.cost == null
    ? '—'
    : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`
const at = (tick) => ({ '--at': String(tick) })
const span = (from, to) => ({ '--from': String(from), '--to': String(to) })

// ── The inputs ─────────────────────────────────────────────────────────

const badge = (i) => el('span', { class: 'bw-num' }, String(i + 1))
const table = (head, rows) =>
  el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table' },
      el('thead', {}, el('tr', {}, head)),
      el('tbody', {}, rows),
    ),
  )

document.getElementById('jobs-note').textContent =
  `${plural(setup.jobs.length, 'job')} · ${plural(setup.messages.length, 'message')} from Theo · the Worker instructions`
document.getElementById('jobs').append(
  table(
    [
      el('th', {}, 'Job'),
      el('th', {}, 'Task'),
      el('th', { class: 'num' }, 'Ticks'),
      el('th', {}, 'Known result'),
    ],
    setup.jobs.map((job) =>
      el(
        'tr',
        {},
        el('td', {}, el('code', {}, job.id)),
        el('td', {}, job.title),
        el('td', { class: 'num' }, String(job.ticks)),
        el('td', {}, el('code', {}, job.answer)),
      ),
    ),
  ),
  table(
    [
      el('th', { class: 'num' }, 'Tick'),
      el('th', {}, 'Theo writes'),
      el('th', {}, 'A right answer names'),
    ],
    setup.messages.map((m, i) =>
      el(
        'tr',
        {},
        el('td', { class: 'num' }, String(m.tick)),
        el('td', {}, badge(i), ' ', m.text),
        el(
          'td',
          {},
          m.key
            ? el('code', {}, m.key)
            : el(
                'span',
                { class: 'mx-muted' },
                'no fixed answer: it asks about a running job',
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
      el('p', { class: 'mx-small bw-task' }, job.task),
      codeBlock(job.input),
    ),
  ),
)

document.getElementById('setup-note').textContent =
  `${setup.modes.length} modes · first message, instructions, tools`
document
  .getElementById('setup')
  .append(
    el('span', { class: 'mx-label' }, 'First message, both modes'),
    codeBlock(setup.start),
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'mx-stack' },
        el('span', { class: 'mx-label' }, `${m.label}: instructions`),
        codeBlock(m.instructions),
        el('span', { class: 'mx-label' }, `${m.label}: tools`),
        codeBlock(prettyJson(m.tools), 'json'),
      ),
    ),
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

  document.getElementById('summary').replaceChildren(
    ...summaries.map((s) =>
      el(
        'tr',
        {},
        el('td', {}, el('b', {}, modeOf(s.mode).label)),
        el(
          'td',
          { class: 'bw-waits' },
          s.perMessage.flatMap((d, i) => [
            badge(i),
            ' ',
            d === null
              ? el('span', { class: 'mx-bad' }, 'no answer')
              : el('span', { class: d > 2 ? 'mx-bad' : 'mx-good' }, one(d)),
          ]),
        ),
        el('td', { class: 'num' }, one(s.totalTicks.mean)),
        el(
          'td',
          { class: `num ${s.told === s.jobs ? 'mx-good' : 'mx-bad'}` },
          `${s.told} of ${s.jobs}`,
        ),
        el(
          'td',
          { class: `num ${s.answersRight === s.keyed ? 'mx-good' : 'mx-bad'}` },
          `${s.answersRight} of ${s.keyed}`,
        ),
        el('td', { class: 'num' }, one(s.requests.mean)),
        el('td', { class: 'bw-nowrap' }, cost(s.usage)),
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

// A dashed guide at each message's tick, through every lane.
const guides = () =>
  setup.messages.map((m) =>
    el('span', { class: 'bw-guide', style: at(m.tick) }),
  )

function lane(label, track, extra = '') {
  return el(
    'div',
    { class: `bw-lane ${extra}` },
    el('div', { class: 'bw-lane-label' }, label),
    el(
      'div',
      { class: 'bw-track' },
      extra === 'is-axis' ? null : guides(),
      track,
    ),
  )
}

function modeLanes(run) {
  const jobs = run.jobs.map((j) =>
    lane(
      el('code', {}, j.jobId),
      j.startedAt === null
        ? el(
            'span',
            { class: 'bw-none mx-small mx-muted', style: at(0) },
            'not started',
          )
        : [
            el('span', {
              class: 'bw-bar',
              style: span(j.startedAt, j.endedAt),
              title: `ran from tick ${j.startedAt} to ${j.endedAt}`,
            }),
            // From the end to the reply that told Theo the result.
            j.toldAt !== null && j.toldAt > j.endedAt
              ? el('span', {
                  class: 'bw-wait is-job',
                  style: span(j.endedAt, j.toldAt),
                })
              : null,
            el(
              'span',
              {
                class: `bw-told ${j.right ? 'is-ok' : 'is-bad'}`,
                style: at(j.toldAt ?? j.endedAt),
                title: j.right
                  ? `result told at tick ${j.toldAt}`
                  : 'the right result never reached Theo',
              },
              j.right ? '✓' : '✗',
            ),
          ],
    ),
  )

  const theo = lane(
    'Theo',
    run.messages.map((m, i) => [
      m.answeredAt === null
        ? null
        : el('span', {
            class: `bw-wait ${m.delay > 2 ? 'is-late' : ''}`,
            style: { ...span(m.tick, m.answeredAt), '--row': String(i) },
          }),
      el(
        'span',
        {
          class: 'bw-msg',
          style: at(m.tick),
          title: `${m.text}\nsent at tick ${m.tick}, answered at ${m.answeredAt ?? 'no tick: no answer'}`,
        },
        String(i + 1),
      ),
    ]),
    'is-theo',
  )

  // A request: a dot when it went out. A blocking call: a hatched span until it returned.
  const coordinator = lane(
    'Coordinator',
    run.steps.map((s) => [
      s.returnedAt > s.at
        ? el('span', {
            class: 'bw-blocked',
            style: span(s.at, s.returnedAt),
            title: `blocked from tick ${s.at} to ${s.returnedAt}`,
          })
        : null,
      el('span', {
        class: 'bw-dot',
        style: at(s.sentAt),
        title: `request ${s.number} at tick ${s.sentAt}: ${s.calls.length ? s.calls.map((c) => c.name).join(', ') : 'reply'}`,
      }),
    ]),
  )

  return [...jobs, theo, coordinator]
}

function renderClock() {
  const done = doneTrials()
  document.getElementById('clock-box').hidden = !done.length
  if (!done.length) {
    return
  }

  const max =
    Math.max(14, ...done.flatMap((t) => t.runs.map((r) => r.totalTicks))) + 1
  const groups = setup.modes
    .flatMap((m) =>
      done.map((t) => {
        const run = t.runs.find((r) => r.mode === m.id)
        return [
          el(
            'div',
            { class: 'bw-group' },
            `${m.label}`,
            done.length > 1
              ? el(
                  'span',
                  { class: 'mx-muted' },
                  ` · run ${trials.findIndex((x) => x.data === t) + 1}`,
                )
              : null,
          ),
          ...modeLanes(run),
        ]
      }),
    )
    .flat()

  const axis = lane(
    el('span', { class: 'mx-small mx-muted' }, 'tick'),
    Array.from({ length: max }, (_, tick) =>
      tick % 2 === 0
        ? el('span', { class: 'bw-tick', style: at(tick) }, String(tick))
        : null,
    ),
    'is-axis',
  )

  document
    .getElementById('clock')
    .replaceChildren(
      el(
        'div',
        { class: 'bw-chart', style: { '--max': String(max) } },
        ...groups,
        axis,
      ),
    )
}

// ── Run by run ─────────────────────────────────────────────────────────

function messagesTable(run) {
  return el(
    'table',
    { class: 'mx-table bw-answers' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Message'),
        el('th', { class: 'num' }, 'Wait'),
        el('th', {}, 'Answer'),
      ),
    ),
    el(
      'tbody',
      {},
      run.messages.map((m, i) => {
        // One reply can answer several queued messages: show it once.
        const first = run.messages.findIndex(
          (x) => x.answeredAt !== null && x.answeredAt === m.answeredAt,
        )

        return el(
          'tr',
          {},
          el(
            'td',
            {},
            el('span', { class: 'bw-nowrap' }, badge(i), ` tick ${m.tick}`),
            el('div', { class: 'mx-small mx-muted' }, setup.messages[i].text),
          ),
          el(
            'td',
            { class: `num ${m.delay === null || m.delay > 2 ? 'mx-bad' : ''}` },
            m.delay === null ? 'no answer' : plural(m.delay, 'tick'),
          ),
          el(
            'td',
            {},
            !m.answer
              ? el('span', { class: 'mx-bad' }, 'no answer')
              : first < i
                ? el(
                    'span',
                    { class: 'mx-muted' },
                    'the same reply as ',
                    badge(first),
                  )
                : modelText(m.answer),
            m.right === false
              ? el(
                  'div',
                  { class: 'mx-small mx-bad' },
                  `does not name ${setup.messages[i].key}`,
                )
              : null,
          ),
        )
      }),
    ),
  )
}

function jobsTable(run) {
  return el(
    'table',
    { class: 'mx-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Job'),
        el('th', { class: 'num' }, 'Ended'),
        el('th', { class: 'num' }, 'Result told'),
      ),
    ),
    el(
      'tbody',
      {},
      run.jobs.map((j) =>
        el(
          'tr',
          {},
          el('td', {}, el('code', {}, j.jobId)),
          el(
            'td',
            { class: 'num' },
            j.endedAt === null ? 'not started' : `tick ${j.endedAt}`,
          ),
          el(
            'td',
            { class: `num ${j.right ? 'mx-good' : 'mx-bad'}` },
            j.right ? `✓ tick ${j.toldAt}` : '✗ not told',
          ),
        ),
      ),
    ),
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack bw-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Request ${step.number} · tick ${step.sentAt} → ${step.returnedAt}`,
        step.returnedAt > step.at
          ? el('span', { class: 'mx-bad' }, ' · blocked')
          : null,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.delivered.map((d) =>
      el(
        'p',
        { class: 'bw-delivered mx-small' },
        el('span', { class: 'mx-muted' }, 'Reached the Coordinator: '),
        d,
      ),
    ),
    step.calls.map((c) =>
      el(
        'div',
        { class: 'bw-call' },
        el(
          'div',
          {},
          el('code', { class: 'bw-call-name' }, c.name),
          ' ',
          el('code', { class: 'mx-muted' }, c.arguments),
        ),
        el('span', { class: 'mx-label' }, 'Tool result'),
        codeBlock(prettyJson(JSON.parse(c.output)), 'json'),
      ),
    ),
    step.text ? modelText(step.text) : null,
    requestResponse(step.request, step.response),
  )
}

function modeColumn(run) {
  return el(
    'div',
    { class: 'mx-stack bw-col' },
    el(
      'div',
      { class: 'bw-col-head' },
      el('b', {}, modeOf(run.mode).label),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(run.steps.length, 'request')} · last reply at tick ${run.totalTicks} · ${usageText(run.usage)}`,
      ),
    ),
    run.end === 'step_limit'
      ? el('p', { class: 'mx-small mx-bad' }, 'Stopped at the request limit.')
      : null,
    messagesTable(run),
    jobsTable(run),
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
          `${run.steps.length} · messages delivered, tool results, raw JSON`,
        ),
      ),
      el('div', { class: 'bw-pad mx-stack' }, run.steps.map(stepView)),
    ),
  )
}

function workersLine(data) {
  return el(
    'p',
    { class: 'mx-small bw-workers' },
    el('span', { class: 'mx-label' }, 'Workers'),
    ' ',
    data.workers.flatMap((w, i) => [
      i ? ' · ' : null,
      el('code', {}, w.jobId),
      ' ',
      el('span', { class: w.right ? '' : 'mx-bad' }, w.report),
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
        { class: 'mx-panel bw-card' },
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
              { class: 'mx-muted bw-pulse' },
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
                { class: 'bw-cols' },
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

  // One run is 14 requests, about $0.001 with the default model.
  document.getElementById('empty').textContent =
    `Press Run. ${plural(n, 'run')} per mode: about ${n * 14} requests, under 1 cent.`
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
    el(
      'option',
      { value: String(i + 1), selected: i + 1 === setup.defaultRuns },
      String(i + 1),
    ),
  ),
)
runsBox.addEventListener('change', renderEmpty)

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

runButton.addEventListener('click', start)
renderEmpty()
