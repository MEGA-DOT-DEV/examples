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
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const num = (n) => n.toLocaleString('en-US')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const KINDS = {
  new_skill: 'New skill',
  change_skill: 'Change skill',
  archive_skill: 'Archive skill',
}
const SEEDED = setup.seeded.length

let runs = setup.runs
let effort = setup.effort
let batch = 0
// Per mode, one slot per run: { state: 'running' | 'done' | 'failed', run, error }.
let state = null

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

const doneRuns = (mode) =>
  state[mode].filter((s) => s.state === 'done').map((s) => s.run)
const finished = (mode) => state[mode].every((s) => s.state !== 'running')

// ── The headline and the totals: one row per mode ──────────────────────

function renderTotals() {
  const row = (mode) => {
    const list = doneRuns(mode)
    // "…" while a run is out; "—" when every run of the mode failed.
    const show = (text) => (!finished(mode) ? '…' : list.length ? text() : '—')
    const per = (pick) => show(() => list.map(pick).join(', '))
    const usage = sumUsage(list.map((r) => r.usage))
    // Every run of a mode sends the same input, so one number says it.
    const tokens = [...new Set(list.map((r) => r.usage.inputTokens))]

    return el(
      'tr',
      {},
      el('th', { scope: 'row' }, setup.modes.find((m) => m.id === mode).name),
      el(
        'td',
        { class: 'num' },
        show(() => `${per((r) => r.found.length)} of ${SEEDED}`),
      ),
      el(
        'td',
        { class: 'num' },
        per((r) => r.oneOff),
      ),
      el(
        'td',
        { class: 'num' },
        per((r) => r.other),
      ),
      el(
        'td',
        { class: 'num' },
        show(() => `${tokens.map(num).join(', ')} per request`),
      ),
      el(
        'td',
        { class: 'num' },
        show(() => (usage.cost == null ? '—' : formatCost(usage.cost))),
      ),
    )
  }

  document.getElementById('totals').replaceChildren(row('all'), row('script'))

  const all = [...doneRuns('all'), ...doneRuns('script')]
  const estimate = all.some((r) => r.usage.costSource === 'estimate')
  document.getElementById('model-note').textContent = [
    all.length
      ? `${all[0].model} · effort ${state.effort} · ${plural(state.runs, 'run')} per mode, one value per run.`
      : '',
    `Cost: all runs of a mode${estimate ? ', estimated' : ''}.`,
    'Not seeded: the proposal matches no seeded pattern. Read it, because it can still be correct.',
  ]
    .filter(Boolean)
    .join(' ')

  const ready =
    finished('all') &&
    finished('script') &&
    doneRuns('all').length &&
    doneRuns('script').length
  const headline = document.getElementById('headline')
  headline.hidden = !ready
  headline.replaceChildren(...(ready ? lead() : []))
}

/** The finding, from the numbers of this run, so it also says when an effect did not show. */
function lead() {
  const a = doneRuns('all')
  const b = doneRuns('script')
  const found = (list) => list.reduce((n, r) => n + r.found.length, 0)
  const share = Math.round(
    (b[0].usage.inputTokens / a[0].usage.inputTokens) * 100,
  )

  return [
    el(
      'strong',
      {},
      `With the script first, the model read ${share}% of the input tokens and found ${found(b)} of ${SEEDED * b.length} seeded patterns in ${plural(b.length, 'run')}.`,
    ),
    ` With every transcript, it found ${found(a)} of ${SEEDED * a.length}.`,
  ]
}

// ── The seeded patterns ────────────────────────────────────────────────

function renderSeeded() {
  const cell = (mode, id) => {
    const list = doneRuns(mode)
    if (!finished(mode)) {
      return el('td', { class: 'num mx-muted' }, '…')
    }

    const k = list.filter((r) => r.found.includes(id)).length
    return el(
      'td',
      { class: 'num' },
      el(
        'span',
        { class: k === list.length && k ? 'mx-good' : k ? '' : 'mx-bad' },
        k
          ? `${k} of ${list.length} ${list.length === 1 ? 'run' : 'runs'}`
          : 'missed',
      ),
    )
  }

  document
    .getElementById('seeded')
    .replaceChildren(
      ...setup.seeded.map((s) =>
        el(
          'tr',
          {},
          el('td', {}, s.about),
          el('td', { class: 'mx-muted' }, s.expect),
          cell('all', s.id),
          cell('script', s.id),
        ),
      ),
    )
}

// ── The proposals, every run open ──────────────────────────────────────

function tag(p) {
  if (p.verdict === 'seeded') {
    return el('span', { class: 'sm-tag sm-tag--hit' }, 'Seeded')
  }
  if (p.verdict === 'repeat') {
    return el('span', { class: 'sm-tag' }, 'Repeat')
  }
  if (p.verdict === 'one-off') {
    return el(
      'span',
      {
        class: 'sm-tag sm-tag--bad',
        title: 'It cites a session whose correction happened once.',
      },
      'One-off',
    )
  }

  return el(
    'span',
    {
      class: 'sm-tag sm-tag--alarm',
      title: 'It matches no seeded pattern. Read it: it may still be right.',
    },
    'Not seeded',
  )
}

function proposalCard(p) {
  const seeded = p.match ? setup.seeded.find((s) => s.id === p.match) : null

  return el(
    'article',
    { class: `sm-proposal${p.verdict === 'one-off' ? ' is-bad' : ''}` },
    el(
      'div',
      { class: 'sm-proposal-head' },
      el('b', {}, KINDS[p.kind]),
      el('code', {}, p.skill),
      tag(p),
    ),
    seeded ? el('span', { class: 'mx-small mx-muted' }, seeded.about) : null,
    modelText(p.change, 'mx-output sm-small'),
    p.evidence.length
      ? el(
          'ul',
          { class: 'sm-evidence' },
          p.evidence.map((e) =>
            el(
              'li',
              {},
              el(
                'code',
                {
                  class: setup.oneOffSessions.includes(e.session)
                    ? 'sm-oneoff'
                    : '',
                },
                e.session,
              ),
              ' ',
              el('span', { class: 'mx-muted' }, `“${e.quote}”`),
            ),
          ),
        )
      : el('p', { class: 'mx-small mx-muted sm-none' }, 'No session cited.'),
  )
}

function runCard(mode, slot, i) {
  const head = el(
    'div',
    { class: 'mx-spread' },
    el('span', { class: 'sm-run' }, `Run ${i + 1}`),
    el(
      'span',
      { class: 'mx-small mx-muted' },
      slot.state === 'done'
        ? usageText(slot.run.usage)
        : slot.state === 'running'
          ? 'asking the model…'
          : 'failed',
    ),
  )

  if (slot.state === 'running') {
    return el('div', { class: 'mx-panel sm-runcard' }, head)
  }
  if (slot.state === 'failed') {
    return el(
      'div',
      { class: 'mx-panel sm-runcard' },
      head,
      el('p', { class: 'mx-bad mx-small' }, slot.error.message),
    )
  }

  const r = slot.run
  return el(
    'div',
    { class: 'mx-panel sm-runcard' },
    head,
    r.proposals.length
      ? r.proposals.map(proposalCard)
      : el('p', { class: 'mx-muted' }, 'No proposals.'),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el(
          'span',
          { class: 'mx-label' },
          `Request and response · run ${i + 1}`,
        ),
        el(
          'span',
          { class: 'mx-muted mx-small' },
          `${num(r.usage.inputTokens)} input tokens`,
        ),
      ),
      el('div', { class: 'sm-pad' }, requestResponse(r.request, r.response)),
    ),
  )
}

function renderProposals() {
  document.getElementById('proposals').replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'mx-stack sm-column' },
        el('h3', { class: 'sm-column-head' }, m.name),
        state[m.id].map((slot, i) => runCard(m.id, slot, i)),
      ),
    ),
  )
}

function render() {
  renderTotals()
  renderSeeded()
  renderProposals()
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const input = { effort, ...picker.value() }
  const slots = () => Array.from({ length: runs }, () => ({ state: 'running' }))
  state = { effort, runs, all: slots(), script: slots() }

  document.getElementById('empty').hidden = true
  for (const box of ['result', 'seeded-box', 'proposals-box']) {
    document.getElementById(box).hidden = false
  }
  render()

  // Every request at once: the runs do not depend on each other.
  await busy(button, 'Running…', () =>
    Promise.all(
      ['all', 'script'].flatMap((mode) =>
        state[mode].map(async (slot) => {
          try {
            slot.run = await call('run', { ...input, mode })
            slot.state = 'done'
          } catch (error) {
            slot.state = 'failed'
            slot.error = error
            showError(notice, error)
          }

          if (id === batch) {
            render()
          }
        }),
      ),
    ),
  )
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
            onPick(value)
            for (const b of container.children) {
              b.setAttribute('aria-pressed', String(b === event.currentTarget))
            }
          },
        },
        String(value),
      ),
    ),
  )
}

function renderEmpty() {
  document.getElementById('empty').textContent =
    `Press Run. ${plural(runs * 2, 'request')}, ${runs} per mode, under 1 cent.`
}

// ── Setup ──────────────────────────────────────────────────────────────

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('intro').textContent =
  `On ${setup.runDate}, a weekly routine reads ${setup.sessions.length} sessions of a coding agent and proposes skill changes. Code scores the proposals against ${SEEDED} seeded patterns.`
document.getElementById('script-line').textContent =
  `A script counts the skill loads and keeps the user follow-ups that look like corrections (${setup.script.corrections} of ${setup.script.followUps}), with no model. One request with only that output.`
document.getElementById('sessions-note').textContent =
  `what A sends · ${setup.sessions.length} sessions · ${num(setup.inputs.all.length)} characters`
document
  .getElementById('sessions')
  .replaceChildren(codeBlock(setup.transcripts, 'md'))
document
  .getElementById('instructions')
  .replaceChildren(codeBlock(setup.instructions, 'md'))
document.getElementById('sends-note').textContent =
  `what B sends · skill list, counts and kept lines · ${num(setup.inputs.script.length)} characters`
document
  .getElementById('script-input')
  .replaceChildren(codeBlock(setup.inputs.script, 'md'))
seg(
  document.getElementById('runs'),
  Array.from({ length: setup.maxRuns }, (_, i) => i + 1),
  runs,
  (v) => {
    runs = v
    renderEmpty()
  },
)
seg(document.getElementById('efforts'), setup.efforts, effort, (v) => {
  effort = v
})
renderEmpty()
button.addEventListener('click', start)
