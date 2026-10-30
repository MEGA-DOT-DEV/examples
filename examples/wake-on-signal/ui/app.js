import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const setup = await call('setup')
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const MODES = setup.modes.map((m) => m.id)
const label = (mode) => setup.modes.find((m) => m.id === mode).label
const eventOn = (day) => setup.events.find((e) => e.day === day)
const eventById = (id) => setup.events.find((e) => e.id === id)
const near = (e, day) => day >= e.day && day <= e.day + setup.lagDays
const daysFor = (mode) =>
  mode === 'schedule' ? setup.days.map((d) => d.day) : setup.wakeDays
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const n = (value) => value.toLocaleString('en-US')
let runs = setup.defaultRuns
let effort = 'low'
// state.results[mode][run][day]: undefined asleep, null waiting, a day run, or { error }.
// state.summary: the finding from api.ts, once every request is done.
let state = null
let batch = 0

// ── The setup: four real problems, two agents, the inputs (folded) ─────

document.getElementById('intro').textContent =
  `Shelf, a reading app, has ${setup.days.length} days of metrics, logs and a competitor's pricing page. The days hide ${setup.events.length} real problems: a good agent reports each one and stays quiet on the other days.`
document
  .getElementById('problems')
  .append(
    ...setup.events.map((e) =>
      el(
        'li',
        {},
        el(
          'span',
          { class: 'ws-problem' },
          el('span', { class: 'mx-muted' }, `Day ${e.day}`),
          el('b', {}, e.title),
        ),
        el('span', { class: 'mx-muted' }, e.detail),
      ),
    ),
  )
document
  .getElementById('agents')
  .append(
    ...setup.modes.map((m) =>
      el('li', {}, el('b', {}, label(m.id)), el('span', {}, m.about)),
    ),
  )

const limits = Object.values(setup.limits)
document.getElementById('check-note').textContent =
  `trips on ${plural(setup.wakeDays.length, 'day')} · never reads the logs`
document
  .getElementById('check')
  .append(
    ...limits.map((l) =>
      el(
        'li',
        {},
        `${l.label} ${l.above ? 'above' : 'below'} ${l.factor} × its median over the 7 days before.`,
      ),
    ),
    el(
      'li',
      {},
      "Any line of the competitor's pricing page that changed against yesterday.",
    ),
    el(
      'li',
      {},
      `It trips on days ${new Intl.ListFormat('en-GB').format(setup.wakeDays.map(String))}. It never reads the log lines.`,
    ),
    ...setup.events.map((e) =>
      el('li', { class: 'mx-muted' }, `${e.title}: ${e.check}.`),
    ),
  )
document.getElementById('scoring-note').textContent =
  'caught, missed, false alarm'
document
  .getElementById('scoring')
  .append(
    el(
      'li',
      {},
      `A report catches a real problem when it comes on the day of the problem or the day after, and names the cause.`,
    ),
    ...setup.events.map((e) =>
      el(
        'li',
        { class: 'mx-muted' },
        `${e.title}: the report must say ${e.words.map((w) => `“${w}”`).join(' or ')}.`,
      ),
    ),
    el(
      'li',
      {},
      'A report about a real problem that does not name the cause, or that repeats a problem that goes on, does not count. It is not a false alarm.',
    ),
    el(
      'li',
      {},
      'Any other report is a false alarm: a report about nothing that mattered.',
    ),
  )
document.getElementById('instructions').append(codeBlock(setup.instructions))
document.getElementById('instructions-note').textContent =
  `${plural(setup.instructions.split('\n').length, 'line')} · the same for both agents`

// ── One cell: what one agent did on one day of one run ─────────────────

/** True when the run is past the problem's days and no report caught it. */
function missedIn(mode, run, e) {
  const cells = state.results[mode][run]
  if (
    Object.entries(cells).some(([day, c]) => c === null && near(e, Number(day)))
  ) {
    return false
  }

  return !Object.values(cells).some((c) => c?.catches === e.id)
}

function kindOf(mode, run, day) {
  const c = state.results[mode][run][day]
  const e = eventOn(day)

  if (c === null) {
    return 'waiting'
  }
  if (c?.error) {
    return 'failed'
  }
  if (e && missedIn(mode, run, e)) {
    return 'missed'
  }
  if (c === undefined) {
    return 'asleep'
  }
  if (!c.report.event) {
    return 'quiet'
  }

  return c.catches ? 'caught' : c.about ? 'about' : 'alarm'
}

// Red only for real failures: a missed problem, a false alarm, a failed request.
const MARKS = {
  caught: { sign: '✓', tone: 'mx-good', key: 'caught a real problem' },
  missed: { sign: '✗', tone: 'mx-bad', key: 'missed a real problem' },
  alarm: { sign: '!', tone: 'mx-bad', key: 'false alarm' },
  about: {
    sign: '~',
    tone: 'mx-muted',
    key: 'about a real problem, but no cause or a repeat',
  },
  quiet: { sign: '·', tone: 'mx-muted', key: 'woke, no report' },
  asleep: { sign: '–', tone: 'ws-asleep', key: 'asleep: no check tripped' },
  failed: { sign: 'x', tone: 'mx-bad', key: 'request failed' },
  waiting: { sign: '·', tone: 'mx-muted ws-pulse', key: 'waiting' },
}

/** The verdict of one cell in words, for the day cards. */
function verdictOf(mode, run, day) {
  const c = state.results[mode][run][day]
  const kind = kindOf(mode, run, day)

  if (kind === 'failed') {
    return el('span', { class: 'mx-bad' }, `Request failed: ${c.error}`)
  }
  if (kind === 'missed') {
    const why =
      c === undefined
        ? 'asleep, no check tripped'
        : !c.report.event
          ? 'no report'
          : c.about
            ? 'the report does not name the cause'
            : 'the report is about something else'

    return el(
      'span',
      {},
      el('b', { class: 'mx-bad' }, 'Missed'),
      el('span', { class: 'mx-muted' }, `: ${why}`),
    )
  }
  if (kind === 'caught') {
    return el(
      'span',
      { class: 'mx-good' },
      `Caught: ${eventById(c.catches).title}`,
    )
  }
  if (kind === 'alarm') {
    return el('b', { class: 'mx-bad' }, 'False alarm')
  }
  if (kind === 'about') {
    const e = eventById(c.about)
    return el(
      'span',
      { class: 'mx-muted' },
      near(e, day)
        ? `About ${e.title.toLowerCase()}, but no cause`
        : `A repeat: ${e.title.toLowerCase()}`,
    )
  }

  return el(
    'span',
    { class: 'mx-muted' },
    kind === 'asleep'
      ? 'Asleep: no check tripped'
      : kind === 'quiet'
        ? 'No report'
        : 'Waiting…',
  )
}

// ── After a run: the finding, the problems, the false alarms ───────────

const headCell = (title, sub) =>
  el('th', {}, title, el('div', { class: 'ws-th-sub' }, sub))
document
  .getElementById('score-head')
  .append(
    el(
      'tr',
      {},
      el('th', {}, 'Real problem'),
      ...setup.modes.map((m) =>
        headCell(
          m.label,
          m.id === 'schedule'
            ? 'reads all data every day'
            : 'wakes on a code check',
        ),
      ),
    ),
  )

function renderResult() {
  const s = state.summary
  const headline = document.getElementById('headline')
  for (const id of ['headline', 'score-box', 'usage-box']) {
    document.getElementById(id).hidden = !s
  }

  if (!s) {
    for (const id of ['cost', 'alarm-note']) {
      document.getElementById(id).textContent = ''
    }
    return
  }

  const [lead, ...rest] = s.headline
  headline.replaceChildren(
    ...[
      el('strong', {}, lead),
      rest.length ? ` ${rest.join(' ')}` : null,
    ].filter(Boolean),
  )

  const done = MODES.flatMap((mode) =>
    state.results[mode].flatMap((r) =>
      Object.values(r).filter((c) => c && !c.error),
    ),
  )
  const cost = (mode) => {
    const list = state.results[mode].flatMap((r) =>
      Object.values(r).filter((c) => c && !c.error),
    )
    return list.some((c) => c.usage.cost == null)
      ? null
      : list.reduce((sum, c) => sum + c.usage.cost, 0)
  }
  const estimate = done.some((c) => c.usage.costSource === 'estimate')
  document.getElementById('cost').textContent =
    `Cost${state.runs > 1 ? ` over ${state.runs} runs` : ''}: ${MODES.map((mode) => `${label(mode).toLowerCase()} ${formatCost(cost(mode))}`).join(', ')}${estimate ? ' (estimates)' : ''}.${done[0] ? ` ${done[0].model}, effort ${state.effort}.` : ''}`

  document.getElementById('score').replaceChildren(
    ...setup.events.map((e) =>
      el(
        'tr',
        {},
        el(
          'td',
          { class: 'ws-nowrap' },
          el('span', { class: 'mx-muted' }, `Day ${e.day} `),
          el('b', {}, e.title),
        ),
        ...MODES.map((mode) => {
          const cell = s.events.find((x) => x.id === e.id).cells[mode]
          return el(
            'td',
            {},
            cell.caught ? el('div', { class: 'mx-good' }, cell.caught) : null,
            cell.missed
              ? el('div', {}, el('b', { class: 'mx-bad' }, cell.missed))
              : null,
            cell.why
              ? el('div', { class: 'mx-small mx-muted' }, cell.why)
              : null,
          )
        }),
      ),
    ),
    el(
      'tr',
      { class: 'ws-alarms' },
      el('td', { class: 'ws-nowrap' }, el('b', {}, 'False alarms')),
      ...MODES.map((mode) => {
        const m = s.modes[mode]
        const any = m.falseAlarms.some((count) => count > 0)
        return el(
          'td',
          {},
          any
            ? el('b', { class: 'mx-bad' }, m.falseAlarmText)
            : el('span', { class: 'mx-muted' }, 'none'),
        )
      }),
    ),
  )

  const example = s.example
  document.getElementById('alarm-note').textContent = example
    ? `A false alarm is a report about nothing that mattered, for example “${example.title}” (${label(example.mode).toLowerCase()}, day ${example.day}).`
    : 'A false alarm is a report about nothing that mattered. Neither agent sent one.'

  document.getElementById('usage-note').textContent =
    `${plural(done.length, 'call')}${state.runs > 1 ? ` over ${state.runs} runs` : ''}`
  document.getElementById('usage').replaceChildren(
    ...MODES.map((mode) => {
      const list = state.results[mode].flatMap((r) =>
        Object.values(r).filter((c) => c && !c.error),
      )
      const sum = (fn) => list.reduce((total, c) => total + fn(c), 0)

      return el(
        'tr',
        {},
        el('td', { class: 'ws-nowrap' }, label(mode)),
        el(
          'td',
          { class: 'num' },
          String(s.modes[mode].calls.reduce((a, b) => a + b, 0)),
        ),
        el('td', { class: 'num' }, n(sum((c) => c.usage.inputTokens))),
        el('td', { class: 'num' }, n(sum((c) => c.usage.outputTokens))),
        el('td', { class: 'num' }, `${(sum((c) => c.ms) / 1000).toFixed(0)} s`),
      )
    }),
  )
}

// ── The strip: one column per day ──────────────────────────────────────

function renderStrip() {
  const shade = (day) => (eventOn(day) ? 'ws-shade' : '')

  // The name of each real problem starts over its day.
  const names = [el('th', {})]
  for (let day = 1; day <= setup.days.length; day++) {
    const e = eventOn(day)
    const next = setup.events.find((x) => x.day > day)
    if (!e) {
      names.push(el('th', {}))
      continue
    }

    const span = (next ? next.day : setup.days.length + 1) - day
    names.push(el('th', { colspan: String(span), class: 'ws-flag' }, e.title))
    day += span - 1
  }

  document
    .getElementById('strip-head')
    .replaceChildren(
      el('tr', {}, ...names),
      el(
        'tr',
        {},
        el('th', { class: 'ws-row-head mx-muted' }, 'Day'),
        ...setup.days.map((d) =>
          el(
            'th',
            { class: `ws-day ${shade(d.day)}`, title: d.date },
            String(d.day),
          ),
        ),
      ),
    )

  const used = new Set()
  const rows = MODES.flatMap((mode) =>
    state.results[mode].map((_, run) =>
      el(
        'tr',
        {},
        el(
          'td',
          { class: 'ws-row-head' },
          state.runs > 1 ? `${label(mode)} · run ${run + 1}` : label(mode),
        ),
        ...setup.days.map((d) => {
          const kind = kindOf(mode, run, d.day)
          used.add(kind)
          const c = state.results[mode][run][d.day]
          const title = c?.report?.event
            ? `${MARKS[kind].key}: ${c.report.title}`
            : MARKS[kind].key

          return el(
            'td',
            { class: `ws-day ${shade(d.day)}` },
            el(
              'span',
              {
                class: `ws-mark ${MARKS[kind].tone}`,
                title: `Day ${d.day}, ${title}`,
              },
              MARKS[kind].sign,
            ),
          )
        }),
      ),
    ),
  )

  document.getElementById('strip').replaceChildren(...rows)
  document.getElementById('legend').replaceChildren(
    ...Object.entries(MARKS)
      .filter(([kind]) => used.has(kind) && kind !== 'waiting')
      .map(([, m]) =>
        el(
          'span',
          { class: 'ws-key' },
          el('b', { class: `ws-mark ${m.tone}` }, m.sign),
          m.key,
        ),
      ),
  )
}

// ── Day by day: the days that matter open, the quiet days in one fold ──

function reportCard(mode, run, day) {
  const c = state.results[mode][run][day]
  const head = state.runs > 1 ? `${label(mode)} · run ${run + 1}` : label(mode)
  const card = el(
    'div',
    { class: 'ws-report' },
    el(
      'div',
      { class: 'ws-report-head' },
      el('span', { class: 'mx-label' }, head),
      el('span', { class: 'mx-small' }, verdictOf(mode, run, day)),
    ),
  )

  if (!c || c.error) {
    return card
  }

  if (c.report.event) {
    card.append(
      el('p', { class: 'ws-title' }, c.report.title),
      modelText(c.report.explanation, 'mx-output ws-explanation'),
    )
  }

  const lines = c.message.split('\n').length
  const read = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Model input'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(lines, 'line')} · ${n(c.usage.inputTokens)} tokens in, ${n(c.usage.outputTokens)} out`,
      ),
    ),
  )

  // Three code blocks per call: build them only when a learner opens this one.
  read.addEventListener('toggle', () => {
    if (read.open && read.children.length === 1) {
      read.append(codeBlock(c.message), requestResponse(c.request, c.response))
    }
  })
  card.append(read)

  return card
}

function dayCard(d) {
  const e = eventOn(d.day)

  return el(
    'section',
    { class: 'ws-daycard' },
    el(
      'div',
      { class: 'ws-dayhead' },
      el('span', { class: 'mx-muted ws-nowrap' }, `Day ${d.day} · ${d.date}`),
      e ? el('b', { class: 'ws-nowrap' }, e.title) : null,
    ),
    el('p', { class: 'ws-happened' }, d.notes.join(' ')),
    d.trips.length
      ? el(
          'p',
          { class: 'mx-small mx-muted' },
          `Code check: ${d.trips.join(' ')}`,
        )
      : null,
    el(
      'div',
      { class: 'ws-reports' },
      ...MODES.flatMap((mode) =>
        state.results[mode].map((_, run) => reportCard(mode, run, d.day)),
      ),
    ),
  )
}

function renderDays() {
  const box = document.getElementById('days')
  box.hidden = !state.summary
  if (box.hidden) {
    return
  }

  const matters = (d) =>
    eventOn(d.day) ||
    MODES.some((mode) =>
      state.results[mode].some(
        (r) => r[d.day]?.error || r[d.day]?.report?.event,
      ),
    )
  const shown = setup.days.filter(matters)
  const quiet = setup.days.filter((d) => !matters(d))

  box.replaceChildren(
    ...[
      el(
        'div',
        { class: 'mx-section-head' },
        el('h3', { class: 'mx-h3' }, 'The days that matter'),
        el(
          'p',
          {},
          'The days of the real problems and every day with a report: what happened, then what each agent did.',
        ),
      ),
      ...shown.map(dayCard),
      quiet.length
        ? el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el(
                'span',
                { class: 'mx-label' },
                `The other ${plural(quiet.length, 'day')}`,
              ),
              el(
                'span',
                { class: 'mx-small mx-muted' },
                'no report from either agent',
              ),
            ),
            el('div', { class: 'ws-pad mx-stack' }, ...quiet.map(dayCard)),
          )
        : null,
    ].filter(Boolean),
  )
}

function render() {
  const all = MODES.flatMap((mode) =>
    state.results[mode].flatMap((r) => Object.values(r)),
  )
  const progress = document.getElementById('progress')
  progress.hidden = Boolean(state.summary)
  progress.textContent = `${all.filter((c) => c !== null).length} of ${plural(all.length, 'request')} done. The strip fills as each one finishes.`

  renderResult()
  renderStrip()
  renderDays()
}

// ── Running ────────────────────────────────────────────────────────────

/** What summary() reads: per agent and run, the reports and the days that failed. */
function runsInput() {
  return Object.fromEntries(
    MODES.map((mode) => [
      mode,
      state.results[mode].map((cells) => ({
        days: Object.values(cells)
          .filter((c) => c && !c.error)
          .map((c) => ({
            day: c.day,
            report: c.report,
            usage: { cost: c.usage.cost ?? null },
          })),
        failed: Object.entries(cells)
          .filter(([, c]) => c?.error)
          .map(([day]) => ({ day: Number(day) })),
      })),
    ]),
  )
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const input = { effort, ...picker.value() }
  state = {
    runs,
    effort,
    summary: null,
    results: Object.fromEntries(
      MODES.map((mode) => [
        mode,
        Array.from({ length: runs }, () =>
          Object.fromEntries(daysFor(mode).map((day) => [day, null])),
        ),
      ]),
    ),
  }

  document.getElementById('empty').hidden = true
  document.getElementById('strip-box').hidden = false
  render()

  const units = []
  for (let run = 0; run < runs; run++) {
    for (const mode of MODES) {
      for (const day of daysFor(mode)) {
        units.push({ mode, run, day })
      }
    }
  }

  let next = 0
  const worker = async () => {
    while (next < units.length && id === batch) {
      const { mode, run, day } = units[next++]

      try {
        const result = await call('day', { ...input, day, mode })
        if (id !== batch) {
          return
        }

        state.results[mode][run][day] = result
      } catch (error) {
        if (id !== batch) {
          return
        }

        state.results[mode][run][day] = { error: error.message }
        showError(notice, error)
      }
      render()
    }
  }

  await busy(button, 'Running…', async () => {
    await Promise.all(Array.from({ length: 6 }, worker))
    if (id !== batch) {
      return
    }

    try {
      state.summary = await call('summary', { runs: runsInput() })
    } catch (error) {
      showError(notice, error)
    }

    if (id === batch) {
      render()
    }
  })
}

function renderEmpty() {
  const requests = runs * (setup.days.length + setup.wakeDays.length)
  document.getElementById('empty').textContent =
    `Press Run. ${requests} requests, ${runs === 3 ? 'about 1 cent' : 'under 1 cent'}.`
}

function seg(container, values, current, onPick) {
  container.replaceChildren(
    ...values.map((value) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === current),
          onclick: (event) => {
            for (const b of container.children) {
              b.setAttribute('aria-pressed', String(b === event.currentTarget))
            }

            onPick(value)
          },
        },
        String(value),
      ),
    ),
  )
}

seg(
  document.getElementById('runs'),
  Array.from({ length: setup.maxRuns }, (_, i) => i + 1),
  runs,
  (count) => {
    runs = count
    renderEmpty()
  },
)
seg(document.getElementById('efforts'), setup.efforts, effort, (value) => {
  effort = value
})
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
button.addEventListener('click', start)
renderEmpty()
