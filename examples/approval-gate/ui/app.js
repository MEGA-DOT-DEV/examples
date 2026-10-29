import {
  busy,
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
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const MODES = setup.modes.map((m) => m.id)
const label = (mode) => setup.modes.find((m) => m.id === mode).label
const about = (mode) => setup.modes.find((m) => m.id === mode).about
let runs = setup.defaultRuns
let effort = 'low'
// state.runs[mode][run][job index]: null while waiting, a job run, or { error }.
let state = null
let batch = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── Inputs (folded, at the end of the page) ────────────────────────────

const ANSWER = { approve: 'yes', deny: 'no' }
const toolCount = setup.jobs.reduce((n, j) => n + j.tools.length, 0)
document.getElementById('jobs-note').textContent =
  `${plural(setup.jobs.length, 'job')} · ${toolCount} tools`
document.getElementById('jobs').append(
  ...setup.jobs.map((job, i) =>
    el(
      'div',
      { class: 'mx-stack ag-job-setup' },
      el(
        'div',
        {},
        el('b', {}, `${i + 1}. ${job.title}`),
        el('p', { class: 'mx-small ag-task' }, job.task),
      ),
      el(
        'div',
        { class: 'mx-table-wrap' },
        el(
          'table',
          { class: 'mx-table ag-tools' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', {}, 'Tool'),
              el('th', {}, 'Tag'),
              el('th', {}, 'Description the model sees'),
              el('th', {}, "Theo's answer"),
            ),
          ),
          el(
            'tbody',
            {},
            job.tools.map((t) =>
              el(
                'tr',
                {},
                el('td', {}, el('code', {}, t.name)),
                el('td', { class: `ag-tag is-${t.safety}` }, t.tag),
                el('td', { class: 'mx-small' }, t.definition.description),
                el(
                  'td',
                  { class: 'mx-small' },
                  job.phone[t.name]
                    ? `${ANSWER[job.phone[t.name].decision]}: "${job.phone[t.name].text}"`
                    : el(
                        'span',
                        { class: 'mx-muted' },
                        'yes: "no need to ask"',
                      ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
)
const policyExample = setup.jobs.find((j) => j.id === 'export-email')
document
  .getElementById('instructions')
  .append(
    el('span', { class: 'mx-label' }, 'Every mode'),
    codeBlock(setup.base),
    el(
      'span',
      { class: 'mx-label' },
      `Policy in the instructions, for "${policyExample.title}"`,
    ),
    codeBlock(policyExample.policy),
  )

// ── Counting ───────────────────────────────────────────────────────────

const doneRuns = (mode) => state.runs[mode].flat().filter((r) => r && !r.error)
const allDone = () => MODES.every((m) => state.runs[m].flat().every((r) => r))

function runTally(list) {
  const ok = list.filter((r) => r && !r.error)

  return {
    done: ok.length,
    unapproved: ok.reduce(
      (n, r) => n + r.actions.filter((a) => a.unapproved).length,
      0,
    ),
    pings: ok.reduce((n, r) => n + r.pings.length, 0),
    unneeded: ok.reduce(
      (n, r) => n + r.pings.filter((p) => !p.needed).length,
      0,
    ),
    finished: ok.filter((r) => r.finished).length,
  }
}

function sumUsage(list) {
  return list.reduce(
    (t, u) => ({
      inputTokens: t.inputTokens + u.inputTokens,
      outputTokens: t.outputTokens + u.outputTokens,
      reasoningTokens: t.reasoningTokens + u.reasoningTokens,
      cost: t.cost == null || u.cost == null ? null : t.cost + u.cost,
      costSource:
        t.costSource === 'estimate' || u.costSource === 'estimate'
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

// ── The result: a headline, then one row per mode, one number per run ──

const headCell = (title, sub) =>
  el('th', { class: 'num' }, title, el('div', { class: 'ag-th-sub' }, sub))
document
  .getElementById('table-head')
  .append(
    el(
      'tr',
      {},
      el('th', {}, 'Mode'),
      headCell('Unapproved', 'irreversible actions that ran without a yes'),
      headCell('Pings', "questions to Theo's phone"),
      headCell('Unneeded pings', 'no yes was necessary'),
      headCell('Finished', `of ${setup.jobs.length} jobs`),
      el('th', { class: 'num' }, 'Cost'),
    ),
  )

function perRun(mode, key) {
  return state.runs[mode]
    .map((row) => {
      const t = runTally(row)
      return t.done === setup.jobs.length
        ? String(t[key])
        : t.done
          ? `${t[key]}…`
          : '…'
    })
    .join(' · ')
}

// One sentence from the run data: how many irreversible actions ran without a yes in each mode.
function headline() {
  if (!allDone()) {
    return [
      el(
        'span',
        { class: 'ag-pulse' },
        'Running. Each job fills in when its agent stops.',
      ),
    ]
  }
  if (MODES.some((m) => !doneRuns(m).length)) {
    return ['Some runs failed. There is nothing to compare.']
  }

  const t = Object.fromEntries(
    MODES.map((m) => [m, runTally(state.runs[m].flat())]),
  )
  const runs = state.count > 1 ? ` in ${state.count} runs per mode` : ''

  return [
    el(
      'strong',
      {},
      `The gate let ${plural(t.gate.unapproved, 'irreversible action')} run without a yes${runs}.`,
    ),
    ` The policy in the instructions let ${t.policy.unapproved} run, and no policy let ${t.none.unapproved}.`,
  ]
}

function renderTable() {
  document.getElementById('headline').replaceChildren(...headline())

  document.getElementById('table').replaceChildren(
    ...MODES.map((mode) => {
      const done = doneRuns(mode)
      const failed = state.runs[mode].flat().filter((r) => r?.error).length
      const cost = sumUsage(done.map((r) => r.usage))
      const requests = done.reduce((n, r) => n + r.steps.length, 0)

      return el(
        'tr',
        {},
        el(
          'td',
          {},
          el('b', {}, label(mode)),
          el('div', { class: 'mx-small mx-muted ag-about' }, about(mode)),
        ),
        el('td', { class: 'num ag-big' }, perRun(mode, 'unapproved')),
        el('td', { class: 'num ag-big' }, perRun(mode, 'pings')),
        el('td', { class: 'num ag-big' }, perRun(mode, 'unneeded')),
        el('td', { class: 'num ag-big' }, perRun(mode, 'finished')),
        el(
          'td',
          { class: 'num mx-small ag-cost' },
          el(
            'div',
            {},
            done.length
              ? `${formatCost(cost.cost)}${cost.costSource === 'estimate' ? ' est.' : ''}`
              : '…',
          ),
          el(
            'div',
            { class: failed ? 'mx-bad' : 'mx-muted' },
            `${plural(requests, 'request')}${failed ? ` · ${failed} failed` : ''}`,
          ),
        ),
      )
    }),
  )

  const first = MODES.flatMap(doneRuns)[0]
  document.getElementById('note').textContent = first
    ? `One number per run. An unneeded ping asks about a reversible or pre-approved tool, or asks again about the same tool. The gate's 0 is true by design: it never runs an irreversible call without a yes. ${first.model} · effort ${state.effort}.`
    : ''
}

// ── Job by job ─────────────────────────────────────────────────────────

const LEGEND = [
  ['is-unapproved', 'ran without a yes'],
  ['is-approved', 'approved on the phone'],
  ['is-held', 'held by the gate, did not run'],
  ['is-pre', 'pre-approved'],
]
document
  .getElementById('legend')
  .append(
    ...LEGEND.map(([cls, text]) =>
      el('span', { class: `ag-chip ${cls}` }, text),
    ),
  )

function actionView(a) {
  // Long arguments (an email body) are cut here; the requests fold has them in full.
  const args = a.args.length > 90 ? `${a.args.slice(0, 89)}…` : a.args
  const name = el(
    'code',
    { title: a.args },
    a.tool,
    a.args === '{}' ? '' : el('span', { class: 'ag-args' }, ` ${args}`),
  )

  if (a.safety === 'reversible') {
    return el(
      'li',
      { class: 'ag-action is-reversible' },
      name,
      a.ran ? null : el('span', { class: 'ag-chip' }, 'error'),
    )
  }

  const [cls, text] = a.unapproved
    ? LEGEND[0]
    : a.approval === 'approved'
      ? LEGEND[1]
      : a.approval === 'held'
        ? LEGEND[2]
        : a.approval === 'pre-approved'
          ? LEGEND[3]
          : ['', 'did not run']

  return el(
    'li',
    { class: `ag-action ${cls}` },
    name,
    el('span', { class: `ag-chip ${cls}` }, text),
  )
}

function pingView(p) {
  return el(
    'li',
    { class: `ag-ping${p.needed ? '' : ' is-unneeded'}` },
    el(
      'div',
      { class: 'mx-small' },
      el('span', { class: 'ag-time' }, p.at),
      ` ${p.from === 'harness' ? 'The harness asks' : 'The agent asks'}: `,
      el('span', { class: 'ag-question' }, p.question),
    ),
    el(
      'div',
      { class: 'mx-small' },
      el(
        'b',
        { class: p.decision === 'approve' ? 'mx-good' : 'mx-bad' },
        p.decision === 'approve' ? 'Yes' : 'No',
      ),
      ` · "${p.reply}"`,
      p.needed
        ? null
        : el('span', { class: 'ag-chip is-unneeded' }, 'unneeded'),
    ),
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack ag-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Request ${step.number} · ${step.calls.length ? plural(step.calls.length, 'tool call') : 'text, no tool call'}`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    step.calls.map((c) =>
      el(
        'div',
        { class: 'ag-call' },
        el('code', { class: 'ag-call-name' }, `${c.name} ${c.arguments}`),
        codeBlock(prettyJsonText(c.output), 'json'),
      ),
    ),
    requestResponse(step.request, step.response),
  )
}

function prettyJsonText(text) {
  try {
    return prettyJson(JSON.parse(text))
  } catch {
    return text
  }
}

function runView(r, run) {
  const head = el(
    'div',
    { class: 'mx-spread ag-run-head' },
    el(
      'span',
      { class: 'mx-label' },
      state.count > 1 ? `Run ${run + 1}` : 'Result',
    ),
    !r
      ? el('span', { class: 'mx-small mx-muted ag-pulse' }, 'running…')
      : r.error
        ? el('span', { class: 'mx-small mx-bad' }, 'failed')
        : r.finished
          ? el('b', { class: 'mx-small mx-good' }, '✓ finished')
          : el(
              'b',
              { class: 'mx-small mx-bad' },
              `✗ failed check: ${r.checks
                .filter((c) => !c.pass)
                .map((c) => c.label.toLowerCase())
                .join('; ')}`,
            ),
  )

  if (!r) {
    return el('div', { class: 'ag-run' }, head)
  }
  if (r.error) {
    return el(
      'div',
      { class: 'ag-run' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  const box = el(
    'details',
    { class: 'mx-details ag-steps' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Requests and responses'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(r.steps.length, 'request')} · ${usageText(r.usage)}`,
      ),
    ),
  )

  // Code blocks for every step: build them only when a learner opens the fold.
  box.addEventListener('toggle', () => {
    if (box.open && box.children.length === 1) {
      box.append(el('div', { class: 'ag-pad mx-stack' }, r.steps.map(stepView)))
    }
  })

  // Actions and pings in the order they happened.
  const timeline = [
    ...r.actions.map((a) => ({ seq: a.seq, view: actionView(a) })),
    ...r.pings.map((p) => ({ seq: p.seq, view: pingView(p) })),
  ].sort((a, b) => a.seq - b.seq)

  return el(
    'div',
    { class: 'ag-run' },
    head,
    el(
      'ul',
      { class: 'ag-actions' },
      timeline.map((t) => t.view),
    ),
    r.pings.length
      ? null
      : el('p', { class: 'mx-small mx-muted ag-noping' }, 'No pings.'),
    modelText(r.text || '(no text)', 'mx-output ag-answer'),
    box,
  )
}

function renderCards() {
  document.getElementById('cards').replaceChildren(
    ...setup.jobs.map((job, i) =>
      el(
        'article',
        { class: 'mx-panel ag-card' },
        el(
          'div',
          {},
          el('b', { class: 'ag-card-title' }, `${i + 1}. ${job.title}`),
          el('p', { class: 'mx-small ag-task' }, job.task),
        ),
        el(
          'div',
          { class: 'ag-grid' },
          MODES.map((mode) =>
            el(
              'section',
              { class: 'ag-col' },
              el('h3', { class: 'ag-col-title' }, label(mode)),
              state.runs[mode].map((row, run) => runView(row[i], run)),
            ),
          ),
        ),
      ),
    ),
  )
}

function render() {
  renderTable()
  renderCards()
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const input = { effort, ...picker.value() }
  state = {
    count: runs,
    effort,
    runs: Object.fromEntries(
      MODES.map((m) => [
        m,
        Array.from({ length: runs }, () => setup.jobs.map(() => null)),
      ]),
    ),
  }

  document.getElementById('empty').hidden = true
  document.getElementById('results').hidden = false
  document.getElementById('jobs-box').hidden = false
  render()

  // Run 1 of every mode first, at most 4 agents at the same time.
  const units = []
  for (let run = 0; run < runs; run++) {
    setup.jobs.forEach((job, i) => {
      for (const mode of MODES) {
        units.push({ mode, run, i, job })
      }
    })
  }

  let next = 0
  const worker = async () => {
    while (next < units.length && id === batch) {
      const { mode, run, i, job } = units[next++]
      try {
        const result = await call('run', { ...input, jobId: job.id, mode })
        if (id !== batch) {
          return
        }
        state.runs[mode][run][i] = result
      } catch (error) {
        if (id !== batch) {
          return
        }
        state.runs[mode][run][i] = { error: error.message }
        showError(notice, error)
      }
      render()
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

function renderEmpty() {
  const requests =
    Math.round((runs * MODES.length * setup.jobs.length * 3.9) / 10) * 10
  document.getElementById('empty').textContent =
    `Press Run. About ${requests} requests, ${runs === 1 ? 'under 1 cent' : runs === 2 ? 'about 1 cent' : 'about 1.5 cents'}.`
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
  (n) => {
    runs = n
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
