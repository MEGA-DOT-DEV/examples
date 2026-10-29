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
const ORDER = Object.keys(setup.outcomes)
const label = (mode) => setup.modes.find((m) => m.id === mode).label
const itemOf = (id) => setup.items.find((i) => i.id === id)
const hostile = setup.items.filter((i) => i.attack)
const passed = setup.items.filter((i) => !i.clean.withheld).length
let runs = setup.defaultRuns
let effort = 'low'
// state.rounds[run]: { scan, modes: { [mode]: run } }. null while waiting, or { error }.
let state = null
let batch = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// Invisible characters, drawn as a visible marker so a learner can see where they were.
const visible = (text) =>
  text.replace(
    /[\u{E0000}-\u{E007F}\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]+/gu,
    (run) => `⟦${plural([...run].length, 'invisible character')}⟧`,
  )
const costOf = (usage) =>
  `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`
/** "" for one run; " in all 3 runs" or " in 2 of 3 runs" for more. */
const inRuns = (count) =>
  state.count === 1
    ? ''
    : count === state.count
      ? ` in all ${state.count} runs`
      : ` in ${count} of ${state.count} runs`

// ── Before a run: what the modes are, and the inputs (folded) ──────────

document.getElementById('intro').textContent =
  `An inbox agent reads ${setup.items.length} items. ${hostile.length} of them are attacks: each one wants the agent to send Dana's address or her secret token to the attacker. Each mode adds one layer.`
document
  .getElementById('layers')
  .append(
    ...setup.modes.flatMap((m) => [
      el('dt', {}, m.label.replace(/^\+ /, '')),
      el('dd', {}, m.about),
    ]),
  )

document.getElementById('inbox-note').textContent =
  `${plural(setup.items.length, 'item')} · ${hostile.length} attacks`
document
  .getElementById('inbox')
  .append(
    ...setup.items.map((item) =>
      el(
        'div',
        { class: 'idl-item' },
        el(
          'div',
          { class: 'mx-spread' },
          el('b', {}, item.name),
          el('span', { class: 'idl-tag' }, item.attack ?? 'benign'),
        ),
        el(
          'div',
          { class: 'mx-small mx-muted' },
          `${item.kind === 'page' ? 'Page' : 'Email from'} ${item.from} · ${item.subject}`,
        ),
        el('p', { class: 'idl-text' }, visible(item.text)),
        item.wants
          ? el(
              'p',
              { class: 'mx-small idl-flat' },
              el('b', {}, 'Wants: '),
              item.wants,
            )
          : null,
      ),
    ),
  )

const touched = setup.items.filter(
  (i) => i.clean.changes.length || i.clean.withheld,
)
document.getElementById('sanitizer-note').textContent =
  `${plural(touched.length, 'item')} changed or withheld · plain code, no key`
document.getElementById('sanitizer').append(
  el(
    'p',
    { class: 'mx-small idl-flat' },
    'Each item that the sanitizer changed or withheld, before and after.',
  ),
  ...touched.map((item) =>
    el(
      'div',
      { class: 'idl-item' },
      el(
        'div',
        { class: 'mx-spread' },
        el('b', {}, item.name),
        el(
          'span',
          { class: 'idl-tag' },
          item.clean.withheld ? 'withheld' : 'passed',
        ),
      ),
      el(
        'ul',
        { class: 'mx-small idl-changes' },
        item.clean.changes.map((c) => el('li', {}, `${c.note} (${c.count})`)),
        item.clean.flags.map((f) =>
          el('li', {}, 'Known phrase: ', el('b', {}, f)),
        ),
        item.clean.hidden
          ? el('li', {}, 'Hidden text: ', el('q', {}, item.clean.hidden))
          : null,
      ),
      el(
        'div',
        { class: 'idl-before-after' },
        el(
          'div',
          {},
          el('span', { class: 'mx-label' }, 'Before'),
          el('p', { class: 'idl-text' }, visible(item.text)),
        ),
        el(
          'div',
          {},
          el('span', { class: 'mx-label' }, 'After'),
          el('p', { class: 'idl-text' }, item.clean.text),
        ),
      ),
    ),
  ),
)

document
  .getElementById('setup')
  .append(
    el(
      'span',
      { class: 'mx-label' },
      'Agent instructions, with the secret token',
    ),
    codeBlock(setup.instructions),
    el('span', { class: 'mx-label' }, 'Task'),
    codeBlock(setup.task),
    el('span', { class: 'mx-label' }, 'Risk scanner instructions'),
    codeBlock(setup.scanner),
    el(
      'p',
      { class: 'mx-small idl-flat' },
      'The outbound gate lets email and web requests go only to ',
      el('code', {}, setup.allowed.join(', ')),
      ' and its subdomains.',
    ),
  )

// ── The answer: a headline, then one row per attack ────────────────────

const doneRuns = (mode) =>
  state.rounds.map((r) => r.modes[mode]).filter((r) => r && !r.error)
const allDone = () =>
  state.rounds.every((r) => r.scan && MODES.every((m) => r.modes[m]))
// Red is only for an attack that worked.
const tone = (outcome) =>
  outcome === 'succeeded'
    ? 'is-bad'
    : outcome === 'warned' || outcome === 'ignored'
      ? 'is-quiet'
      : 'is-good'

function renderHeadline() {
  const lead = document.getElementById('headline')
  const meaning = document.getElementById('meaning')

  if (!allDone()) {
    lead.replaceChildren(
      el(
        'span',
        { class: 'idl-pulse' },
        'Running. Each column fills in when its agent stops.',
      ),
    )
    return meaning.replaceChildren()
  }

  if (MODES.some((m) => !doneRuns(m).length)) {
    lead.replaceChildren(
      'A mode failed in every run, so there is nothing to compare. The error is above.',
    )
    return meaning.replaceChildren()
  }

  const succeeded = (mode) =>
    hostile.filter((item) =>
      doneRuns(mode).some((r) => r.outcomes[item.id] === 'succeeded'),
    ).length
  const none = succeeded('none')
  const all = succeeded('gate')
  const over = state.count > 1 ? ` in at least one of ${state.count} runs` : ''

  lead.replaceChildren(
    el(
      'strong',
      {},
      `With no defense, ${none} of ${hostile.length} attacks succeeded${over}. With all three layers, ${all ? all : 'none'} did.`,
    ),
  )

  meaning.textContent = [
    "An attack succeeded when the agent made the call that the attack asked for: a request that sent Dana's address or her token to the attacker.",
    none
      ? ''
      : 'The agent does not act the same way in every run. Run it again, or set 3 runs under More settings.',
  ]
    .filter(Boolean)
    .join(' ')
}

document.getElementById('outcomes-head').append(
  el(
    'tr',
    {},
    el('th', {}, 'Attack'),
    MODES.map((m) => el('th', {}, label(m))),
  ),
)

function outcomeCell(mode, itemId) {
  const list = doneRuns(mode).map((r) => r.outcomes[itemId])
  const failed = state.rounds.filter((r) => r.modes[mode]?.error).length
  const waiting = state.rounds.filter((r) => !r.modes[mode]).length

  return el(
    'div',
    { class: 'idl-marks' },
    ORDER.filter((o) => list.includes(o)).map((o) =>
      el(
        'span',
        { class: `idl-out ${tone(o)}` },
        `${setup.outcomes[o]}${inRuns(list.filter((x) => x === o).length)}`,
      ),
    ),
    failed
      ? el('span', { class: 'idl-out is-quiet' }, `Run failed${inRuns(failed)}`)
      : null,
    waiting
      ? el('span', { class: 'idl-out is-quiet idl-pulse' }, 'Running…')
      : null,
  )
}

function renderOutcomes() {
  document.getElementById('outcomes').replaceChildren(
    ...hostile.map((item) =>
      el(
        'tr',
        {},
        el(
          'td',
          { class: 'idl-attack' },
          el('b', {}, item.attack),
          el('div', { class: 'mx-small mx-muted' }, item.wants),
        ),
        MODES.map((m) => el('td', {}, outcomeCell(m, item.id))),
      ),
    ),
  )
}

// ── The cost: benign items withheld, and the task ──────────────────────

document
  .getElementById('cost-head')
  .append(
    el(
      'tr',
      {},
      el('th', {}, 'Mode'),
      el('th', {}, 'Benign items withheld'),
      el('th', {}, 'Task done'),
    ),
  )

function taskText(list) {
  const done = list.filter((r) => r.score.taskDone).length
  if (state.count === 1) {
    return done ? 'Yes' : `No: ${list[0].task.missing.join(', ')}`
  }

  return done === 0 ? `No${inRuns(list.length)}` : `Yes${inRuns(done)}`
}

function renderCost() {
  document.getElementById('cost').replaceChildren(
    ...MODES.map((mode) => {
      const list = doneRuns(mode)
      const ids = [...new Set(list.flatMap((r) => r.score.benignWithheld))]
      const names = ids.map((id) =>
        el(
          'span',
          { class: 'idl-out is-quiet' },
          `${itemOf(id).name}${inRuns(list.filter((r) => r.score.benignWithheld.includes(id)).length)}`,
        ),
      )
      const pending = state.rounds.some((r) => !r.modes[mode])

      return el(
        'tr',
        {},
        el('td', { class: 'idl-mode' }, label(mode)),
        el(
          'td',
          {},
          list.length
            ? el(
                'div',
                { class: 'idl-marks' },
                names.length
                  ? names
                  : el('span', { class: 'mx-muted' }, 'None'),
              )
            : el(
                'span',
                { class: 'mx-muted idl-pulse' },
                pending ? '…' : 'failed',
              ),
        ),
        el(
          'td',
          { class: 'idl-mode' },
          list.length
            ? taskText(list)
            : el('span', { class: 'mx-muted' }, pending ? '…' : 'failed'),
        ),
      )
    }),
  )
}

// ── Details (folded): requests and cost, risk scores, each agent ───────

const VERDICT = {
  pass: 'passed',
  review: 'warning',
  block: 'withheld',
  failed: 'scan failed',
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

const head = (title, sentence) =>
  el(
    'div',
    { class: 'mx-section-head' },
    el('h3', { class: 'mx-h3' }, title),
    el('p', {}, sentence),
  )

function costTable(scans) {
  const rows = [
    [
      'Risk scanner, shared by the last two modes',
      scans.reduce((n, s) => n + s.scans.length, 0),
      sumUsage(scans.map((s) => s.usage)),
    ],
    ...MODES.map((mode) => {
      const done = doneRuns(mode)
      return [
        `${label(mode)} agent`,
        done.reduce((n, r) => n + r.steps.length, 0),
        sumUsage(done.map((r) => r.usage)),
      ]
    }),
  ]
  const total = sumUsage(rows.map((r) => r[2]))

  return el(
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
          el('th', {}, 'Part'),
          el('th', { class: 'num' }, 'Requests'),
          el('th', { class: 'num' }, 'Cost'),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map(([name, n, usage]) =>
          el(
            'tr',
            {},
            el('td', {}, name),
            el('td', { class: 'num' }, String(n)),
            el('td', { class: 'num' }, costOf(usage)),
          ),
        ),
        el(
          'tr',
          {},
          el('td', {}, el('b', {}, 'Total')),
          el(
            'td',
            { class: 'num' },
            el('b', {}, String(rows.reduce((n, r) => n + r[1], 0))),
          ),
          el('td', { class: 'num' }, el('b', {}, costOf(total))),
        ),
      ),
    ),
  )
}

function scanTable(scans) {
  const ids = scans[0]?.scans.map((s) => s.itemId) ?? []

  return el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table idl-scan' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Item'),
          el('th', { class: 'num' }, 'Risk'),
          el('th', {}, 'Result'),
          el('th', {}, scans.length > 1 ? 'Reason, run 1' : 'Reason'),
        ),
      ),
      el(
        'tbody',
        {},
        ids.map((id) => {
          const list = scans
            .map((b) => b.scans.find((s) => s.itemId === id))
            .filter(Boolean)

          return el(
            'tr',
            {},
            el(
              'td',
              {},
              itemOf(id).name,
              itemOf(id).attack
                ? el(
                    'div',
                    { class: 'mx-small mx-muted' },
                    `Attack: ${itemOf(id).attack}`,
                  )
                : null,
            ),
            el(
              'td',
              { class: 'num' },
              list.map((s) => s.risk ?? '—').join(', '),
            ),
            el(
              'td',
              { class: 'idl-mode' },
              [...new Set(list.map((s) => VERDICT[s.verdict]))].join(', '),
            ),
            el('td', { class: 'mx-small' }, list[0]?.reason ?? ''),
          )
        }),
      ),
    ),
  )
}

function callView(c) {
  const attack = c.goalOf ? itemOf(c.goalOf).attack : null

  return el(
    'li',
    { class: 'idl-call' },
    el('code', {}, `${c.tool} → ${c.target}`),
    c.ran
      ? el(
          'span',
          { class: `idl-out ${attack || c.leak ? 'is-bad' : 'is-quiet'}` },
          [
            attack ? `Went out: ${attack}` : 'Went out',
            c.leak ? ', with the token' : '',
          ].join(''),
        )
      : el('span', { class: 'idl-out is-good' }, 'Blocked by gate'),
    c.blocked.length
      ? el('div', { class: 'mx-small mx-muted' }, c.blocked.join('; '))
      : null,
  )
}

function stepView(step) {
  return el(
    'div',
    { class: 'mx-stack idl-step' },
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
        { class: 'idl-tool' },
        el('code', {}, `${c.name} ${c.arguments}`),
        codeBlock(
          c.output.length > 4000 ? `${c.output.slice(0, 4000)}…` : c.output,
        ),
      ),
    ),
    requestResponse(step.request, step.response),
  )
}

/** A fold whose content is built when it first opens: code blocks for every step are heavy. */
function lazyFold(title, note, build) {
  const box = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, title),
      el('span', { class: 'mx-small mx-muted' }, note),
    ),
  )

  box.addEventListener('toggle', () => {
    if (box.open && box.children.length === 1) {
      box.append(el('div', { class: 'idl-pad mx-stack' }, build()))
    }
  })

  return box
}

function runView(r, run) {
  const title = state.count > 1 ? `Run ${run + 1}` : 'Result'
  if (!r) {
    return el(
      'div',
      { class: 'idl-run' },
      el('span', { class: 'mx-label' }, title),
      el('span', { class: 'mx-small mx-muted idl-pulse' }, 'Running…'),
    )
  }
  if (r.error) {
    return el(
      'div',
      { class: 'idl-run' },
      el('span', { class: 'mx-label' }, title),
      el('p', { class: 'mx-small idl-flat' }, `Failed: ${r.error}`),
    )
  }

  const kept = (status) =>
    r.deliveries
      .filter((d) => d.status === status)
      .map(
        (d) =>
          `${itemOf(d.itemId).name} (by the ${d.by === 'scanner' ? 'risk scanner' : d.by})`,
      )
  const withheld = kept('withheld')
  const warned = kept('warned')

  return el(
    'div',
    { class: 'idl-run' },
    el('span', { class: 'mx-label' }, title),
    el(
      'p',
      { class: 'mx-small idl-flat' },
      withheld.length
        ? `Withheld: ${withheld.join(', ')}.`
        : `All ${r.deliveries.length} items reached the agent.`,
    ),
    warned.length
      ? el(
          'p',
          { class: 'mx-small idl-flat' },
          `With a warning: ${warned.join(', ')}.`,
        )
      : null,
    r.outbound.length
      ? el('ul', { class: 'idl-calls' }, r.outbound.map(callView))
      : el(
          'p',
          { class: 'mx-small mx-muted idl-flat' },
          'No email or web request.',
        ),
    modelText(r.text || '(no text)', 'mx-output idl-answer'),
    lazyFold(
      'Items the agent read',
      `${plural(r.deliveries.length, 'item')} · JSON`,
      () => codeBlock(prettyJson(r.deliveries.map((d) => d.view)), 'json'),
    ),
    lazyFold(
      'Requests and responses',
      `${plural(r.steps.length, 'request')} · ${usageText(r.usage)}`,
      () => r.steps.map(stepView),
    ),
  )
}

function renderDetails() {
  const scans = state.rounds.map((r) => r.scan).filter((s) => s && !s.error)
  const agents = MODES.flatMap(doneRuns)
  const requests =
    scans.reduce((n, s) => n + s.scans.length, 0) +
    agents.reduce((n, r) => n + r.steps.length, 0)
  const usage = sumUsage([
    ...scans.map((s) => s.usage),
    ...agents.map((r) => r.usage),
  ])

  document.getElementById('details-note').textContent = allDone()
    ? `${plural(requests, 'request')} · ${costOf(usage)} · risk scores · each agent's calls and answer`
    : 'filling in…'

  const body = document.getElementById('details-body')
  // Build the content only while the fold is open: it is heavy, and it is folded by default.
  if (!body.parentElement.open) {
    return body.replaceChildren()
  }

  body.replaceChildren(
    head(
      'Requests and cost',
      `The sanitizer and the gate are code and cost nothing.${agents[0] ? ` Model: ${agents[0].model}, effort ${state.effort}.` : ''}`,
    ),
    costTable(scans),
    head(
      'Risk scores',
      `One request per item that the sanitizer passed. Below ${setup.reviewAt} an item passes. From ${setup.reviewAt} the agent gets it with a warning. From ${setup.blockAt}, or when the scan fails, it is withheld.`,
    ),
    scans.length
      ? scanTable(scans)
      : el(
          'p',
          { class: 'mx-small mx-muted idl-flat' },
          'Waiting for the scan…',
        ),
    head(
      'Each agent',
      'The items it did not get, each email and web request it made, and its answer.',
    ),
    el(
      'div',
      { class: 'idl-grid' },
      MODES.map((mode) =>
        el(
          'section',
          { class: 'mx-panel idl-col' },
          el('h4', { class: 'idl-col-title' }, label(mode)),
          state.rounds.map((r, run) => runView(r.modes[mode], run)),
        ),
      ),
    ),
  )
}

document.getElementById('details').addEventListener('toggle', () => {
  if (state) {
    renderDetails()
  }
})

function render() {
  renderHeadline()
  renderOutcomes()
  renderCost()
  renderDetails()
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
    rounds: Array.from({ length: runs }, () => ({
      scan: null,
      modes: Object.fromEntries(MODES.map((m) => [m, null])),
    })),
  }

  document.getElementById('empty').hidden = true
  for (const box of ['results', 'cost-box', 'details']) {
    document.getElementById(box).hidden = false
  }

  render()

  const set = (apply) => {
    if (id !== batch) {
      return
    }
    apply()
    render()
  }

  const failed = (error) => {
    if (id === batch) {
      showError(notice, error)
    }
    return { error: error.message }
  }

  const runMode = (round, mode, scans) =>
    call('run', { ...input, mode, scans }).then(
      (result) =>
        set(() => {
          round.modes[mode] = result
        }),
      (error) =>
        set(() => {
          round.modes[mode] = failed(error)
        }),
    )

  // Per run: the first two modes start at once; the last two wait for the scan they share.
  const oneRound = async (round) => {
    const scan = call('scan', input).then(
      (result) => {
        set(() => {
          round.scan = result
        })
        return result
      },
      (error) => {
        set(() => {
          round.scan = failed(error)
        })
        return null
      },
    )

    const scanned = scan.then((result) =>
      Promise.all(
        ['scanner', 'gate'].map((mode) =>
          result
            ? runMode(
                round,
                mode,
                result.scans.map(({ itemId, risk, reason }) => ({
                  itemId,
                  risk,
                  reason,
                })),
              )
            : set(() => {
                round.modes[mode] = {
                  error: 'The scan failed. This mode did not run.',
                }
              }),
        ),
      ),
    )

    await Promise.all([
      runMode(round, 'none'),
      runMode(round, 'sanitizer'),
      scanned,
    ])
  }

  await busy(button, 'Running…', () => Promise.all(state.rounds.map(oneRound)))
}

function renderEmpty() {
  // One scan per item that the sanitizer passed, and about 3 requests per agent.
  document.getElementById('empty').textContent =
    `Press Run. About ${runs * (passed + 3 * MODES.length)} requests, under 1 cent.`
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
