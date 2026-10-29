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
// Requests per run, roughly: no docs 2, docs 4, docs and validator 5.
const REQUESTS_PER_ROUND = 11
const PARALLEL = 3
let batch = 0
// The latest batch: one job per mode and run, in run order.
let jobs = []
let summary = null
let effort = 'low'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const num = (n) => n.toLocaleString('en-US')
const modeOf = (id) => setup.modes.find((m) => m.id === id)

// ── Setup ──────────────────────────────────────────────────────────────

document.getElementById('intro').textContent =
  `The agent writes the settings of ${setup.harness}, a made-up harness, in three modes: no docs, docs as tools, and docs and validator. Code counts the wishes met and the invented keys.`
document.getElementById('request').textContent = setup.request
document.getElementById('request-note').textContent =
  `${setup.wishes.length} wishes · the same in every mode`
document.getElementById('docs-note').textContent =
  `${plural(setup.docs.length, 'page')} · ${setup.settingsCount} settings`
document
  .getElementById('docs')
  .append(
    ...setup.docs.map((d) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('code', {}, `${d.name}.md`),
          el('span', { class: 'mx-muted mx-small' }, d.title),
        ),
        codeBlock(d.text, 'md'),
      ),
    ),
  )
document
  .getElementById('schema')
  .append(codeBlock(prettyJson(setup.schema), 'json'))
document.getElementById('modes-note').textContent = setup.modes
  .map((m) => `${m.label}: ${plural(m.tools.length, 'tool')}`)
  .join(' · ')
document
  .getElementById('modes')
  .append(
    ...setup.modes.flatMap((m) => [
      el(
        'div',
        { class: 'mx-stack sc-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small mx-muted' }, m.about),
        el('span', { class: 'mx-label' }, 'Instructions'),
        codeBlock(m.instructions),
        el(
          'span',
          { class: 'mx-label' },
          `Tools: ${m.tools.map((t) => t.name).join(', ')}`,
        ),
        codeBlock(prettyJson(m.tools), 'json'),
      ),
    ]),
  )

for (let n = 1; n <= setup.maxRuns; n++) {
  runsBox.append(
    el(
      'option',
      { value: String(n), selected: n === setup.defaultRuns },
      String(n),
    ),
  )
}

const efforts = document.getElementById('efforts')
efforts.append(
  ...setup.efforts.map((value) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(value === effort),
        onclick: () => {
          effort = value
          for (const b of efforts.children) {
            b.setAttribute('aria-pressed', String(b.textContent === value))
          }
        },
      },
      value,
    ),
  ),
)

function renderEmpty() {
  const runs = Number(runsBox.value)
  document.getElementById('empty').textContent =
    `Press Run. ${setup.modes.length} modes × ${plural(runs, 'run')}: about ${runs * REQUESTS_PER_ROUND} requests, under 1 cent.`
}

// ── The totals ─────────────────────────────────────────────────────────

const done = () => jobs.filter((j) => j.state === 'done')

async function refreshSummary(id) {
  const records = done().map((j) => j.result.record)
  if (!records.length) {
    return
  }

  const next = await call('summary', { records })
  if (id === batch) {
    summary = next
  }
}

const wishCount = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// The headline comes from summary(), so the page and the CLI say the same thing.
function lead(running) {
  if (running) {
    return [`Running… ${done().length} of ${jobs.length} runs done.`]
  }
  if (!summary?.headline.lead) {
    return []
  }
  return [el('strong', {}, summary.headline.lead), ` ${summary.headline.rest}`]
}

function renderTotals() {
  document.getElementById('result').hidden = !jobs.length
  document.getElementById('totals-box').hidden = !summary

  const running = jobs.some(
    (j) => j.state === 'running' || j.state === 'waiting',
  )
  const list = summary?.totals ?? []
  document.getElementById('lead').replaceChildren(...lead(running))

  if (!summary) {
    return
  }

  document
    .getElementById('totals-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, ''),
        ...list.map((t) => el('th', { class: 'num' }, t.label)),
      ),
    )

  const range = (met) =>
    met.length > 1 && Math.min(...met) !== Math.max(...met)
      ? ` (${Math.min(...met)} to ${Math.max(...met)})`
      : ''
  const cost = (u) =>
    u.cost == null
      ? '—'
      : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`
  const rows = [
    [
      `Wishes met per run, of ${setup.wishes.length}`,
      (t) => `${wishCount(t.meanMet)}${range(t.met)}`,
      'sc-strong',
    ],
    ['Files Tarnwick would load', (t) => `${t.loads} of ${t.runs}`],
    [
      'Invented keys',
      (t) =>
        el('span', { class: t.invented ? 'mx-bad' : '' }, String(t.invented)),
    ],
    [
      'Type errors',
      (t) =>
        el(
          'span',
          { class: t.typeErrors ? 'mx-bad' : '' },
          String(t.typeErrors),
        ),
    ],
    ['Tokens, all runs', (t) => num(t.usage.totalTokens)],
    ['Cost, all runs', (t) => cost(t.usage)],
  ]

  document
    .getElementById('totals')
    .replaceChildren(
      ...rows.map(([label, value, cls]) =>
        el(
          'tr',
          { class: cls ?? '' },
          el('td', {}, label),
          ...list.map((t) => el('td', { class: 'num' }, value(t))),
        ),
      ),
    )

  const model = done()[0]?.result.model
  const notes = [
    list.some((t) => range(t.met))
      ? 'A range in brackets shows the lowest and the highest run.'
      : null,
    model ? `Model: ${model}, effort ${done()[0].effort}.` : null,
  ]

  document.getElementById('note').textContent = notes.filter(Boolean).join(' ')
}

// ── The wishes ─────────────────────────────────────────────────────────

function renderWishes() {
  const modes = setup.modes
  document
    .getElementById('wishes-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Wish'),
        ...modes.map((m) => el('th', { class: 'sc-marks-head' }, m.label)),
      ),
    )

  document.getElementById('wishes').replaceChildren(
    ...setup.wishes.map((wish, i) =>
      el(
        'tr',
        {},
        el(
          'td',
          { class: 'sc-wish' },
          el('div', {}, `${i + 1}. ${wish.text}`),
          el(
            'div',
            { class: 'mx-small mx-muted' },
            'Needs ',
            el('code', {}, wish.needs),
          ),
        ),
        ...modes.map((m) =>
          el(
            'td',
            { class: 'sc-marks' },
            jobs
              .filter((j) => j.mode === m.id)
              .map((j) => {
                if (j.state === 'done') {
                  const ok = j.result.score.met.includes(wish.id)
                  return el(
                    'span',
                    { class: ok ? 'mx-good' : 'mx-bad', title: `Run ${j.run}` },
                    ok ? '✓' : '✗',
                  )
                }
                if (j.state === 'failed') {
                  return el(
                    'span',
                    { class: 'mx-muted', title: `Run ${j.run} failed` },
                    '!',
                  )
                }
                return el(
                  'span',
                  {
                    class: `mx-muted${j.state === 'running' ? ' sc-pulse' : ''}`,
                    title: `Run ${j.run}`,
                  },
                  '·',
                )
              }),
          ),
        ),
      ),
    ),
  )
}

// ── The files ──────────────────────────────────────────────────────────

function fileView(lines) {
  return el(
    'pre',
    { class: 'sc-file' },
    lines.map((l) =>
      el('span', { class: l.mark ? `is-${l.mark}` : '' }, l.text),
    ),
  )
}

function callView(c) {
  return el(
    'div',
    { class: 'sc-call' },
    el(
      'div',
      {},
      el('code', { class: 'sc-call-name' }, c.name),
      ' ',
      el(
        'code',
        { class: 'mx-muted sc-call-args' },
        c.arguments.length > 160
          ? `${c.arguments.slice(0, 160)}…`
          : c.arguments,
      ),
    ),
    el(
      'span',
      { class: `mx-label${c.error ? ' mx-bad' : ''}` },
      c.error ? 'Tool error, sent back to the model' : 'Tool result',
    ),
    codeBlock(c.output),
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack sc-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Request ${step.number} · ${step.calls.length ? plural(step.calls.length, 'tool call') : 'no tool call'}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.calls.map(callView),
    requestResponse(step.request, step.response),
  )
}

function statusOf(job) {
  if (job.state === 'failed') {
    return el('span', { class: 'mx-bad mx-small' }, 'request failed')
  }
  if (job.state !== 'done') {
    return el(
      'span',
      {
        class: `mx-muted mx-small${job.state === 'running' ? ' sc-pulse' : ''}`,
      },
      job.state === 'running' ? 'running…' : 'waiting',
    )
  }

  const s = job.result.score
  const file =
    job.result.settings === null
      ? 'no file saved'
      : s.loads
        ? 'loads'
        : 'does not load'

  return el(
    'span',
    { class: 'mx-small' },
    el(
      'b',
      { class: s.met.length === setup.wishes.length ? 'mx-good' : 'mx-bad' },
      `${s.met.length} of ${setup.wishes.length} wishes`,
    ),
    el('span', { class: s.loads ? 'mx-muted' : 'mx-bad' }, ` · ${file}`),
  )
}

function cardView(job) {
  const r = job.result

  return el(
    'article',
    { class: 'mx-panel sc-card' },
    el(
      'div',
      { class: 'mx-spread' },
      el('b', {}, `${modeOf(job.mode).label} · run ${job.run}`),
      statusOf(job),
    ),
    job.state === 'failed'
      ? el('p', { class: 'mx-small mx-bad' }, job.error)
      : null,
    r
      ? [
          r.lines
            ? fileView(r.lines)
            : el(
                'p',
                { class: 'mx-small mx-muted' },
                'The agent saved no file.',
              ),
          r.score.typeErrors.length
            ? el(
                'ul',
                { class: 'sc-errors mx-small' },
                r.score.typeErrors.map((e) => el('li', {}, el('code', {}, e))),
              )
            : null,
          el(
            'div',
            { class: 'sc-answer' },
            el('span', { class: 'mx-label' }, 'Agent reply'),
            modelText(r.text),
          ),
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el(
                'span',
                { class: 'mx-label' },
                `Steps · ${plural(r.steps.length, 'request')}`,
              ),
              el('span', { class: 'mx-small mx-muted' }, usageText(r.usage)),
            ),
            el('div', { class: 'sc-pad mx-stack' }, r.steps.map(stepView)),
          ),
        ]
      : null,
  )
}

function renderFiles() {
  document.getElementById('evidence').hidden = !jobs.length
  document.getElementById('files').replaceChildren(...jobs.map(cardView))
}

function render() {
  renderTotals()
  renderWishes()
  renderFiles()
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const runs = Number(runsBox.value)
  const settings = { effort, ...picker.value() }

  // Run order: run 1 of every mode first, so each column fills at the same pace.
  jobs = Array.from({ length: runs }, (_, i) =>
    setup.modes.map((m) => ({
      mode: m.id,
      run: i + 1,
      state: 'waiting',
      result: null,
      error: null,
    })),
  ).flat()
  summary = null

  document.getElementById('empty').hidden = true
  runButton.disabled = true
  render()

  let next = 0
  const worker = async () => {
    while (next < jobs.length && id === batch) {
      const job = jobs[next++]
      job.state = 'running'
      render()
      try {
        job.result = await call('run', { mode: job.mode, ...settings })
        job.effort = settings.effort
        job.state = 'done'
        await refreshSummary(id)
      } catch (error) {
        job.state = 'failed'
        job.error = error.message
        showError(notice, error)
      }
      if (id === batch) {
        render()
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: PARALLEL }, worker))
  } finally {
    if (id === batch) {
      runButton.disabled = false
      render()
    }
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
runsBox.addEventListener('change', renderEmpty)
runButton.addEventListener('click', start)
renderEmpty()
render()
