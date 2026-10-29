import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const button = document.getElementById('go')
const notice = document.getElementById('notice')
const VERSIONS = setup.versions
let runs = setup.defaultRuns
let effort = 'low'
// state.hand[id][version][run - 1] and state.suite[rowId][version][run - 1]: null while waiting, a decision, or { error }.
let state = null
let batch = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const pct = (n) => `${Math.round(n * 100)}%`
const factsText = (f) =>
  `${f.plan} · day ${f.days} · €${f.amount} · ${plural(f.refunds, 'earlier refund')}`
const rowsIn = (category) =>
  setup.rows.filter((r) => r.category === category).length
const ok = (list) => list.filter((t) => t && !t.error)

// ── Inputs: the edit, the skills, the policy, the generator ────────────

const edit = setup.diff
  .split('\n')
  .filter((line) => line.startsWith('-') || line.startsWith('+'))
document.getElementById('edit').append(codeBlock(edit.join('\n'), 'diff'))
document.getElementById('skills-note').textContent =
  `skill/v1.md and skill/v2.md · ${setup.skills.v1.split('\n').length} lines each`
document
  .getElementById('skills')
  .append(
    ...VERSIONS.flatMap((v) => [
      el('span', { class: 'mx-label' }, v.label),
      codeBlock(setup.skills[v.id], 'md'),
    ]),
  )

const { windowDays, largeCharge, repeatRefunds } = setup.policy
const levels = setup.levels
document.getElementById('policy-note').textContent =
  `4 rules · ${setup.rows.length} rows in ${setup.categories.length} categories`
document
  .getElementById('policy')
  .append(
    el(
      'p',
      { class: 'mx-small se-text' },
      'expected() in policy.ts gives the right decision. It checks these rules in this order:',
    ),
    el(
      'ol',
      { class: 'mx-small se-rules' },
      el(
        'li',
        {},
        `${repeatRefunds} or more refunds in the last 12 months: `,
        el('b', {}, 'escalate'),
        '.',
      ),
      el(
        'li',
        {},
        `A charge over €${largeCharge}: `,
        el('b', {}, 'escalate'),
        '.',
      ),
      el(
        'li',
        {},
        `Past the refund window (monthly ${windowDays.monthly} days, annual ${windowDays.annual} days): `,
        el('b', {}, 'deny'),
        '.',
      ),
      el('li', {}, 'Anything else: ', el('b', {}, 'approve'), '.'),
    ),
    el(
      'p',
      { class: 'mx-small se-text' },
      `The matrix crosses every level: plan (${levels.plan.join(', ')}) × days since the charge (${levels.days.join(', ')}) × charge (${levels.amount.map((a) => `€${a}`).join(', ')}) × earlier refunds (${levels.refunds.join(', ')}) = ${setup.rows.length} rows. The rule that decides a row gives its category.`,
    ),
  )
document.getElementById('generator-note').textContent = plural(
  setup.generator.split('\n').length,
  'line',
)
document.getElementById('generator').append(codeBlock(setup.generator))

// ── Decisions as chips ─────────────────────────────────────────────────

function chip(t) {
  if (!t) {
    return el('span', { class: 'se-chip se-pulse' }, '…')
  }
  if (t.error) {
    return el('span', { class: 'se-chip is-fail', title: t.error }, 'failed')
  }

  return el(
    'span',
    { class: `se-chip ${t.pass ? 'is-pass' : 'is-fail'}`, title: t.reason },
    t.decision ?? 'invalid',
  )
}
const chips = (list) => el('div', { class: 'se-chips' }, list.map(chip))
const ticketCell = (facts, message) =>
  el(
    'td',
    { class: 'se-ticket' },
    el('b', {}, facts),
    el('p', { class: 'mx-small' }, message),
  )

// ── The result: headline and pass rates ────────────────────────────────

document
  .getElementById('score-head')
  .append(
    el(
      'tr',
      {},
      el('th', {}, 'Tickets'),
      el('th', { class: 'num' }, 'Count'),
      el('th', {}, 'Right decision'),
      ...VERSIONS.map((v) => el('th', { class: 'num' }, v.label)),
    ),
  )

function rateCell(s, compare, sub) {
  if (!s) {
    return el('td', { class: 'num se-big mx-muted' }, state.done ? '–' : '…')
  }

  const trend =
    compare && compare.mean !== s.mean
      ? s.mean < compare.mean
        ? ' is-worse'
        : ' is-better'
      : ''

  return el(
    'td',
    { class: `num${trend}` },
    el('div', { class: 'se-big' }, pct(s.mean)),
    // The range shows only when the runs differ.
    sub
      ? el('div', { class: 'mx-small mx-muted' }, sub)
      : s.min === s.max
        ? null
        : el(
            'div',
            { class: 'mx-small mx-muted' },
            `${pct(s.min)}–${pct(s.max)}`,
          ),
  )
}

function renderScore() {
  const summary = state.summary
  const hand = (v) =>
    summary?.hand[v].total
      ? { mean: summary.hand[v].passed / summary.hand[v].total }
      : null
  const rows = [
    el(
      'tr',
      { class: 'se-split' },
      el('td', {}, el('b', {}, 'Hand-picked')),
      el('td', { class: 'num' }, String(setup.hand.length)),
      el('td', {}, [...new Set(setup.hand.map((c) => c.expected))].join(', ')),
      ...VERSIONS.map((v, i) =>
        rateCell(
          hand(v.id),
          i ? hand('v1') : null,
          hand(v.id) &&
            `${summary.hand[v.id].passed} of ${summary.hand[v.id].total} runs`,
        ),
      ),
    ),
  ]
  for (const c of setup.categories) {
    const s = summary?.categories.find((x) => x.id === c.id)
    rows.push(
      el(
        'tr',
        {},
        el('td', {}, c.label),
        el('td', { class: 'num' }, String(rowsIn(c.id))),
        el('td', {}, c.decision),
        rateCell(s?.spread.v1),
        rateCell(s?.spread.v2, s?.spread.v1),
      ),
    )
  }
  rows.push(
    el(
      'tr',
      { class: 'se-split' },
      el('td', {}, el('b', {}, 'All generated')),
      el('td', { class: 'num' }, String(setup.rows.length)),
      el('td', {}),
      rateCell(summary?.overall.v1),
      rateCell(summary?.overall.v2, summary?.overall.v1),
    ),
  )

  document.getElementById('score').replaceChildren(...rows)

  const decisions = Object.values(state.suite).flatMap((byV) =>
    VERSIONS.flatMap((v) => byV[v.id]),
  )
  const generated = Object.values(state.scenarios).filter((s) => s).length
  document.getElementById('note').textContent = state.done
    ? `Pass rate: the share of runs with the right decision.${state.runs > 1 ? ' A range under a rate shows the lowest and the highest run.' : ''}`
    : `Writing tickets: ${generated} of ${setup.rows.length}. Decisions: ${ok(decisions).length} of ${setup.rows.length * VERSIONS.length * state.runs}.`

  renderHeadline()
}

/** The finding in one or two sentences, from the scored run. */
function renderHeadline() {
  const box = document.getElementById('headline')
  const summary = state.summary
  box.hidden = !state.done || !summary
  if (box.hidden) {
    return
  }

  const { v1, v2 } = summary.hand
  const hand = `The ${setup.hand.length} hand-picked tickets went from ${v1.passed} to ${v2.passed} of ${v2.total} runs right`
  const worse = summary.worse.length

  if (!summary.overall.v1 || !summary.overall.v2) {
    box.replaceChildren(
      el(
        'strong',
        {},
        'No generated ticket has a decision, so the suite has no result.',
      ),
      ` ${hand}.`,
    )
  } else if (!worse) {
    box.replaceChildren(
      el(
        'strong',
        {},
        'The suite found no generated ticket that version 2 gets wrong more often.',
      ),
      ` ${hand}.`,
    )
  } else {
    box.replaceChildren(
      el(
        'strong',
        {},
        `The suite found ${plural(worse, 'generated ticket')} that version 2 gets wrong more often.`,
      ),
      ` ${hand}${v2.passed > v1.passed ? ', so they show only the fix' : ''}.`,
    )
  }
}

// ── The evidence: decisions per ticket ─────────────────────────────────

const decisionHead = (first) =>
  el(
    'tr',
    {},
    el('th', {}, first),
    el('th', {}, 'Right decision'),
    ...VERSIONS.map((v) => el('th', {}, v.label)),
  )
document.getElementById('hand-head').append(decisionHead('Ticket'))
document.getElementById('changed-head').append(decisionHead('Generated ticket'))

function renderHand() {
  document
    .getElementById('hand')
    .replaceChildren(
      ...setup.hand.map((c) =>
        el(
          'tr',
          {},
          ticketCell(factsText(c), c.message),
          el('td', {}, el('b', {}, c.expected)),
          ...VERSIONS.map((v) => el('td', {}, chips(state.hand[c.id][v.id]))),
        ),
      ),
    )
}

const scenarioOf = (id) =>
  state.scenarios[id] && !state.scenarios[id].error ? state.scenarios[id] : null

function renderChanged() {
  const ids = state.done && state.summary ? state.summary.changed : []
  document.getElementById('changed-box').hidden = !ids.length
  document.getElementById('changed').replaceChildren(
    ...ids.map((id) => {
      const row = setup.rows.find((r) => r.id === id)
      return el(
        'tr',
        {},
        ticketCell(
          `${row.id} · ${factsText(row)}`,
          scenarioOf(id)?.message ?? '',
        ),
        el('td', {}, el('b', {}, row.expected)),
        ...VERSIONS.map((v) => el('td', {}, chips(state.suite[id][v.id]))),
      )
    }),
  )
}

function renderTickets() {
  const list = setup.rows.map((r) => ({ row: r, s: state.scenarios[r.id] }))
  const kept = list.filter(
    ({ s }) => s && !s.error && s.message !== null,
  ).length
  const again = list.filter(
    ({ s }) => s && !s.error && s.attempts.length > 1,
  ).length
  const dropped = list.length - kept

  document.getElementById('tickets-note').textContent =
    `${kept} of ${setup.rows.length} kept · ${again} written again after a failed check · ${dropped} dropped`
  document
    .getElementById('tickets-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Row'),
        el('th', {}, 'Category'),
        el('th', {}, 'Right decision'),
        el('th', {}, 'Customer message'),
      ),
    )

  document
    .getElementById('tickets')
    .replaceChildren(
      ...list.map(({ row, s }) =>
        el(
          'tr',
          {},
          el(
            'td',
            { class: 'se-nowrap' },
            el('b', {}, row.id),
            el('div', { class: 'mx-small mx-muted' }, factsText(row)),
          ),
          el(
            'td',
            { class: 'mx-small' },
            setup.categories.find((c) => c.id === row.category).label,
          ),
          el('td', {}, row.expected),
          el(
            'td',
            { class: 'mx-small' },
            !s
              ? '…'
              : s.error
                ? el('span', { class: 'mx-bad' }, s.error)
                : (s.message ??
                  el(
                    'span',
                    { class: 'mx-bad' },
                    'Dropped: no draft passed the check.',
                  )),
            ...(s?.attempts ?? [])
              .filter((a) => a.problems.length)
              .map((a) =>
                el(
                  'div',
                  { class: 'se-rejected' },
                  `Rejected draft: "${a.message}" `,
                  el('span', { class: 'mx-bad' }, a.problems.join(' ')),
                ),
              ),
          ),
        ),
      ),
    )
}

function sumUsage(list) {
  return list.reduce(
    (t, u) => ({
      cost: t.cost == null || u.cost == null ? null : t.cost + u.cost,
      estimate: t.estimate || u.costSource === 'estimate',
    }),
    { cost: 0, estimate: false },
  )
}

function costText(label, usages) {
  const { cost, estimate } = sumUsage(usages)
  return `${label}: ${plural(usages.length, 'request')}, ${cost == null ? 'cost unknown' : `${formatCost(cost)}${estimate ? ' est.' : ''}`}`
}

function phases() {
  const hand = Object.values(state.hand).flatMap((byV) =>
    VERSIONS.flatMap((v) => ok(byV[v.id])),
  )
  const attempts = Object.values(state.scenarios).flatMap((s) =>
    s && !s.error ? s.attempts : [],
  )
  const suite = Object.values(state.suite).flatMap((byV) =>
    VERSIONS.flatMap((v) => ok(byV[v.id])),
  )

  return { hand, attempts, suite }
}

function renderCost() {
  const { hand, attempts, suite } = phases()
  const first = hand[0] ?? suite[0]
  const usages = [...hand, ...attempts, ...suite].map((x) => x.usage)

  document.getElementById('cost').textContent =
    state.done && first
      ? [
          costText(
            'Hand-picked',
            hand.map((t) => t.usage),
          ),
          costText(
            'Generation',
            attempts.map((a) => a.usage),
          ),
          costText(
            'Suite',
            suite.map((t) => t.usage),
          ),
          costText('Total', usages),
          `${(state.ms / 1000).toFixed(0)} s`,
          first.model,
          `effort ${state.effort}`,
        ].join(' · ')
      : ''
}

function renderRaw() {
  const { hand, attempts, suite } = phases()
  const label = (id) => VERSIONS.find((v) => v.id === id).label
  const items = [
    ...hand.map((t) => ({
      title: `Hand-picked · ${t.id} · ${label(t.version)} · run ${t.run}`,
      x: t,
    })),
    ...Object.values(state.scenarios).flatMap((s) =>
      s && !s.error
        ? s.attempts.map((a, i) => ({
            title: `Generation · ${s.row.id} · try ${i + 1}`,
            x: a,
          }))
        : [],
    ),
    ...suite.map((t) => ({
      title: `Suite · ${t.id} · ${label(t.version)} · run ${t.run}`,
      x: t,
    })),
  ]

  document.getElementById('raw-note').textContent = plural(
    hand.length + attempts.length + suite.length,
    'request',
  )

  document.getElementById('raw').replaceChildren(
    ...items.map(({ title, x }) => {
      const box = el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, title),
          el('span', { class: 'mx-small mx-muted' }, usageText(x.usage)),
        ),
      )

      // Two code blocks per request: build them only when a learner opens this one.
      box.addEventListener('toggle', () => {
        if (box.open && box.children.length === 1) {
          box.append(
            el(
              'div',
              { class: 'se-pad' },
              requestResponse(x.request, x.response),
            ),
          )
        }
      })

      return box
    }),
  )
}

function render() {
  renderScore()
  renderHand()
  renderChanged()
  renderCost()

  for (const id of ['tickets-box', 'raw-box']) {
    document.getElementById(id).hidden = !state.done
  }
  if (state.done) {
    renderTickets()
    renderRaw()
  }
}

// ── Running ────────────────────────────────────────────────────────────

/**
 * Scores the page's decisions with the same code as the CLI (summary() in
 * api.ts). Calls that arrive while one runs fold into one more round.
 */
let scoring = null
let stale = false
function rescore(id) {
  if (scoring) {
    stale = true
    return scoring
  }

  scoring = (async () => {
    try {
      do {
        stale = false
        const marks = [
          ...Object.values(state.hand),
          ...Object.values(state.suite),
        ]
          .flatMap((byV) => VERSIONS.flatMap((v) => ok(byV[v.id])))
          .map((t) => ({
            version: t.version,
            id: t.id,
            run: t.run,
            decision: t.decision,
          }))
        const summary = await call('summary', { marks })
        if (id !== batch) {
          return
        }
        state.summary = summary
        render()
      } while (stale)
    } catch (error) {
      showError(notice, error)
    } finally {
      scoring = null
    }
  })()

  return scoring
}

async function pool(tasks, id) {
  let next = 0
  const worker = async () => {
    while (next < tasks.length && id === batch) {
      await tasks[next++]()
    }
  }

  await Promise.all(Array.from({ length: 6 }, worker))
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const input = { effort, ...picker.value() }
  const slots = () =>
    Object.fromEntries(
      VERSIONS.map((v) => [v.id, Array.from({ length: runs }, () => null)]),
    )
  state = {
    runs,
    effort,
    done: false,
    summary: null,
    ms: 0,
    hand: Object.fromEntries(setup.hand.map((c) => [c.id, slots()])),
    scenarios: Object.fromEntries(setup.rows.map((r) => [r.id, null])),
    suite: Object.fromEntries(setup.rows.map((r) => [r.id, slots()])),
  }

  const started = performance.now()
  document.getElementById('empty').hidden = true
  for (const box of ['score-box', 'evidence']) {
    document.getElementById(box).hidden = false
  }
  render()

  /** One request: put its result (or its error) in place and redraw. */
  const task = (fn, put, score) => async () => {
    try {
      const result = await fn()
      if (id !== batch) {
        return
      }
      put(result)
      if (score) {
        void rescore(id)
      }
    } catch (error) {
      if (id !== batch) {
        return
      }
      put({ error: error.message })
      showError(notice, error)
    }

    if (id === batch) {
      render()
    }
  }

  const decide = (store, rowOrCase, message) =>
    VERSIONS.flatMap((v) =>
      Array.from({ length: runs }, (_, r) =>
        task(
          () =>
            call('triage', {
              ...input,
              version: v.id,
              id: rowOrCase,
              message,
              run: r + 1,
            }),
          (result) => {
            store[rowOrCase][v.id][r] = result
          },
          true,
        ),
      ),
    )

  await busy(button, 'Running…', async () => {
    // The hand-picked tickets and the generation first; then both versions on the same generated tickets.
    await pool(
      [
        ...setup.hand.flatMap((c) => decide(state.hand, c.id)),
        ...setup.rows.map((r) =>
          task(
            () => call('generate', { ...input, rowId: r.id }),
            (s) => {
              state.scenarios[r.id] = s
            },
          ),
        ),
      ],
      id,
    )

    await pool(
      setup.rows
        .filter((r) => scenarioOf(r.id)?.message)
        .flatMap((r) => decide(state.suite, r.id, scenarioOf(r.id).message)),
      id,
    )

    if (id !== batch) {
      return
    }
    await rescore(id)
    state.done = true
    state.ms = performance.now() - started
    render()
  })
}

function renderEmpty() {
  const requests =
    (setup.hand.length + setup.rows.length) * VERSIONS.length * runs +
    setup.rows.length
  const cost =
    runs === 1 ? 'under 1 cent' : runs === 2 ? 'about 1 cent' : 'under 2 cents'

  document.getElementById('empty').textContent =
    `Press Run. About ${requests} requests, ${cost}.`
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
