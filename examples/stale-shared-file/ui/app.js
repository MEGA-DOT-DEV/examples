import {
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

const setup = await call('setup')
const runButton = document.getElementById('run')
const runsBox = document.getElementById('runs')
const notice = document.getElementById('notice')
const empty = document.getElementById('empty')
const result = document.getElementById('result')
const cards = document.getElementById('cards')

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const cost = (u) =>
  u.cost == null
    ? '—'
    : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`
// Times are seconds after midnight.
const clock = (seconds) => {
  const s = Math.floor(seconds)
  return [s / 3600, (s % 3600) / 60, s % 60]
    .map((v) => String(Math.floor(v)).padStart(2, '0'))
    .join(':')
}
const modeOf = (id) => setup.modes.find((m) => m.id === id)
const SENT = {
  stale: "sent yesterday's facts",
  fresh: "sent today's facts",
  empty: 'sent a brief without facts',
  unsent: 'sent nothing',
}

// ── What the agents get ────────────────────────────────────────────────

document.getElementById('sources-note').textContent =
  `${plural(setup.sources.length, 'source')} · the file before research writes it`
document
  .getElementById('sources')
  .append(
    ...setup.sources.map((s) =>
      el(
        'div',
        { class: 'mx-stack' },
        el(
          'span',
          { class: 'mx-label' },
          `${s.id} · answers after ${s.minutes[0]} to ${s.minutes[1]} min`,
        ),
        codeBlock(s.text),
      ),
    ),
    el('span', { class: 'mx-label' }, "research.md before today's run"),
    codeBlock(setup.yesterdayFile),
  )

document.getElementById('agents-note').textContent =
  '2 agents · instructions, task, tools'
const agentSetup = (name, trigger, agent) =>
  el(
    'div',
    { class: 'mx-stack' },
    el('b', {}, name, ' ', el('code', {}, trigger)),
    el('span', { class: 'mx-label' }, 'Instructions'),
    codeBlock(agent.instructions),
    el('span', { class: 'mx-label' }, 'Task'),
    codeBlock(agent.task),
    el('span', { class: 'mx-label' }, 'Tools'),
    codeBlock(prettyJson(agent.tools), 'json'),
  )
document
  .getElementById('agents')
  .append(
    agentSetup('Research agent', setup.research.trigger, setup.research),
    agentSetup(
      'Brief agent',
      setup.modes.map((m) => m.trigger).join(' or '),
      setup.brief,
    ),
  )

// ── The timeline of one run ────────────────────────────────────────────

function lane(name, schedule, marks) {
  return el(
    'div',
    { class: 'ssf-lane' },
    el(
      'div',
      { class: 'ssf-lane-label' },
      el('span', {}, name),
      schedule ? el('code', {}, schedule) : null,
    ),
    el('div', { class: 'ssf-track' }, marks),
  )
}

/** Positions on the time axis, as CSS percentages. */
function scaleOf(axis) {
  const x = (t) =>
    `${(((t - axis.from) / (axis.to - axis.from)) * 100).toFixed(2)}%`
  const bar = (from, to) => ({
    left: x(from),
    width: `calc(${x(to)} - ${x(from)})`,
  })

  return { x, bar }
}

function timeline(trial, axis) {
  const scale = scaleOf(axis)
  const { file } = trial
  const written = file.length > 1 ? file[1].at : null
  const guide =
    written === null
      ? null
      : el('span', { class: 'ssf-guide', style: { left: scale.x(written) } })

  return el(
    'div',
    { class: 'ssf-chart' },
    fileLane(written, axis, scale),
    researchLane(trial.research, guide, scale),
    ...trial.briefs.map((brief) => briefLane(brief, guide, scale)),
    ticksLane(axis, scale),
  )
}

function fileLane(written, axis, { bar }) {
  return lane('research.md', null, [
    el(
      'span',
      { class: 'ssf-file is-old', style: bar(axis.from, written ?? axis.to) },
      "yesterday's",
    ),
    written === null
      ? null
      : el(
          'span',
          {
            class: 'ssf-file',
            style: bar(written, axis.to),
            title: `research.md written at ${clock(written)}`,
          },
          "today's",
        ),
  ])
}

function researchLane(research, guide, { x, bar }) {
  return lane('Research', research.trigger, [
    guide,
    el('span', {
      class: 'ssf-bar',
      style: bar(research.start, research.done),
      title: `${clock(research.start)} to ${clock(research.done)}`,
    }),
    // Each source read is a segment of the bar; a long one gets its name.
    ...research.reads.map((r) =>
      el(
        'span',
        {
          class: 'ssf-read',
          style: bar(r.from, r.to),
          title: `${r.source}: ${Math.round((r.to - r.from) / 60)} min`,
        },
        r.to - r.from >= 8 * 60 ? r.source : '',
      ),
    ),
    el(
      'span',
      { class: 'ssf-mark', style: { left: x(research.done) } },
      `done ${clock(research.done)}`,
    ),
  ])
}

function briefLane(b, guide, { x }) {
  const sent = b.sends[0]

  return lane(modeOf(b.mode).brief, b.trigger, [
    guide,
    el('span', {
      class: `ssf-dot ${b.outcome === 'stale' ? 'is-bad' : ''} ${sent ? '' : 'is-hollow'}`,
      style: { left: x(b.start) },
    }),
    el(
      'span',
      {
        class: `ssf-mark ${b.outcome === 'stale' ? 'mx-bad' : ''}`,
        style: { left: x(sent?.at ?? b.start) },
      },
      sent ? `sent ${clock(sent.at)}` : 'sent nothing',
    ),
  ])
}

function ticksLane(axis, { x }) {
  const ticks = []
  for (let t = axis.from; t <= axis.to; t += 15 * 60) {
    ticks.push(
      el(
        'span',
        { class: 'ssf-tick', style: { left: x(t) } },
        clock(t).slice(0, 5),
      ),
    )
  }

  return lane('', null, ticks)
}

// ── One run: the timeline, then the two sent briefs ────────────────────

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack ssf-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el('span', { class: 'mx-label' }, `Request ${step.number}`),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.calls.map((c) =>
      el(
        'div',
        { class: 'mx-stack' },
        el('code', { class: 'ssf-call' }, `${c.name} ${c.arguments}`),
        codeBlock(c.output),
      ),
    ),
    step.text ? el('p', { class: 'mx-small ssf-text' }, step.text) : null,
    requestResponse(step.request, step.response),
  )
}

const requestsFold = (title, steps, usage, extra = null) =>
  el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, title),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(steps.length, 'request')} · ${cost(usage)}`,
      ),
    ),
    el('div', { class: 'ssf-pad mx-stack' }, extra, steps.map(stepView)),
  )

// Did the agent tell Angie that the research is from yesterday? A flag only in its last reply did not reach her.
function flagLine(said) {
  if (!said) {
    return [
      el(
        'span',
        { class: 'mx-muted' },
        'The brief does not say that the research is from yesterday.',
      ),
    ]
  }

  return said.in === 'brief'
    ? ['The brief says that the research is from yesterday.']
    : [
        "The brief does not say that the research is from yesterday. Only the agent's last reply does: ",
        el('q', {}, said.text),
      ]
}

function briefColumn(brief) {
  const mode = modeOf(brief.mode)
  const read = brief.read ? `read ${brief.read}'s research.md` : 'read no file'

  return el(
    'div',
    { class: 'mx-stack ssf-col' },
    el(
      'div',
      { class: 'ssf-col-head' },
      el('b', {}, mode.label),
      el('code', {}, `brief: ${brief.trigger}`),
    ),
    el(
      'p',
      { class: `ssf-state ${brief.outcome === 'stale' ? 'mx-bad' : ''}` },
      `It ${read} and ${SENT[brief.outcome]}.`,
    ),
    // The code marks each sentence that carries a fact from yesterday's file.
    brief.sends.length
      ? el(
          'div',
          { class: 'ssf-brief' },
          brief.check.segments.map((s) =>
            el('span', { class: s.stale ? 'ssf-stale' : '' }, s.text),
          ),
        )
      : null,
    brief.read === 'yesterday'
      ? el('p', { class: 'mx-small' }, ...flagLine(brief.saidOld))
      : null,
    brief.sends.length
      ? null
      : el(
          'p',
          { class: 'mx-small' },
          el('span', { class: 'mx-muted' }, 'Its last answer: '),
          brief.answer,
        ),
    requestsFold('Requests and cost', brief.steps, brief.usage),
  )
}

function card(trial, i, axis) {
  const { research, file, delays } = trial
  const written = file.length > 1 ? file.at(-1) : null

  return el(
    'article',
    { class: 'mx-panel mx-stack ssf-card' },
    el('b', {}, `Run ${i + 1}`),
    timeline(trial, axis),
    el(
      'p',
      { class: 'mx-small mx-muted ssf-note' },
      `Source delays, drawn for this run: ${setup.sources.map((s) => `${s.id} ${delays[s.id]} min`).join(', ')}. Model requests add their real time.`,
    ),
    requestsFold(
      'Research agent',
      research.steps,
      research.usage,
      written
        ? [
            el(
              'span',
              { class: 'mx-label' },
              `research.md, written at ${clock(written.at)}`,
            ),
            codeBlock(written.text),
          ]
        : el(
            'p',
            { class: 'mx-bad' },
            'The research agent did not write research.md.',
          ),
    ),
    el('div', { class: 'ssf-cols' }, trial.briefs.map(briefColumn)),
  )
}

function render({ trials, summary }) {
  result.hidden = false
  result.replaceChildren(
    el(
      'p',
      { class: 'mx-lead' },
      el('strong', {}, summary.headline),
      ` ${summary.detail}`,
    ),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${plural(summary.requests, 'request')} · ${cost(summary.usage)}`,
    ),
  )

  // One axis for every run, from the research start to after the last event.
  const times = trials.flatMap((t) => [
    t.research.done,
    ...t.briefs.flatMap((b) => [b.start, ...b.sends.map((s) => s.at)]),
  ])
  const from = Math.min(...trials.map((t) => t.research.start))
  const axis = {
    from,
    to: from + Math.ceil((Math.max(...times) + 10 * 60 - from) / 900) * 900,
  }

  cards.replaceChildren(...trials.map((t, i) => card(t, i, axis)))
}

// ── Running ────────────────────────────────────────────────────────────

function renderEmpty() {
  const n = Number(runsBox.value)
  // One run is about 9 requests and $0.0005 with the default model.
  empty.textContent = `Press Run. ${plural(n, 'run')}: about ${n * 9} requests, under 1 cent.`
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const n = Number(runsBox.value)
  runButton.disabled = true
  result.hidden = true
  cards.replaceChildren()
  empty.hidden = false
  empty.textContent = `Running ${plural(n, 'run')}: research, then both briefs…`

  try {
    render(await call('run', { ...picker.value(), runs: n }))
    empty.hidden = true
  } catch (error) {
    showError(notice, error)
    renderEmpty()
  } finally {
    runButton.disabled = false
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
