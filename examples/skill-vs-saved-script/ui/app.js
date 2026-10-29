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
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const DAYS = setup.days
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const time = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
// "est." shows once, in the note above the tables, not in every cell.
const cost = (u) => (u.cost == null ? '—' : formatCost(u.cost))

let effort = setup.effort
let repeatDay = setup.repeatDay
let batch = 0
// One slot per run: { state: 'running' | 'done' | 'failed', run, error }.
let state = null

// ── Sums ───────────────────────────────────────────────────────────────

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

const keySize = (day) =>
  setup.scored.reduce(
    (n, list) => n + setup.mornings[day - 1].key[list].length,
    0,
  )

function totals(slots) {
  const runs = slots.filter((s) => s.state === 'done').map((s) => s.run)

  return {
    done: slots.every((s) => s.state === 'done' || s.state === 'failed'),
    correct: runs.reduce((n, r) => n + (r.score?.correct ?? 0), 0),
    expected: slots.reduce((n, _, i) => n + keySize(i + 1), 0),
    extra: runs.reduce((n, r) => n + (r.score?.extra.length ?? 0), 0),
    exact: runs.filter((r) => r.score?.exact).length,
    calls: runs.reduce((n, r) => n + r.modelCalls, 0),
    usage: sumUsage(runs.map((r) => r.usage)),
    ms: runs.reduce((n, r) => n + r.ms, 0),
  }
}

/** Distinct briefs among the skill's runs on the repeat day. */
function skillDistinct() {
  const slots = [state.skill[state.repeatDay - 1], ...state.repeats]
  if (slots.some((s) => s.state === 'running' || s.state === 'waiting')) {
    return null
  }

  const keys = slots.map((s) =>
    s.run?.brief
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(s.run.brief).map(([k, v]) => [k, [...v].sort()]),
          ),
        )
      : `error ${s.error?.message ?? s.run?.error}`,
  )

  return { distinct: new Set(keys).size, runs: slots.length }
}

// ── The week: totals and one sentence ──────────────────────────────────

function renderTotals() {
  const a = totals(state.skill)
  const b = totals(state.script)
  const aDistinct = skillDistinct()
  const bDistinct = state.script[state.repeatDay - 1]?.run?.distinct ?? null
  const dots = el('span', { class: 'mx-muted' }, '…')

  const row = (name, t, distinct) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row' }, name),
      el(
        'td',
        { class: 'num' },
        t.done
          ? `${t.correct} of ${t.expected}${t.extra ? ` +${t.extra}` : ''}`
          : dots.cloneNode(true),
      ),
      el(
        'td',
        { class: 'num' },
        t.done
          ? el(
              'span',
              { class: t.exact === DAYS ? 'mx-good' : 'mx-bad' },
              `${t.exact} of ${DAYS}`,
            )
          : dots.cloneNode(true),
      ),
      el(
        'td',
        { class: 'num' },
        t.done ? String(t.calls) : dots.cloneNode(true),
      ),
      el('td', { class: 'num' }, t.done ? cost(t.usage) : dots.cloneNode(true)),
      el('td', { class: 'num' }, t.done ? time(t.ms) : dots.cloneNode(true)),
      el(
        'td',
        { class: 'num' },
        distinct
          ? `${distinct.distinct} of ${distinct.runs}`
          : t.done
            ? '—'
            : dots.cloneNode(true),
      ),
    )

  document.getElementById('distinct-head').textContent =
    `Distinct briefs, day ${state.repeatDay}`
  document
    .getElementById('totals')
    .replaceChildren(
      row('A. Skill only', a, aDistinct),
      row('B. Saved script', b, bDistinct),
    )

  const first = [...state.skill, ...state.script].find((s) => s.run?.model)?.run
  const extra = state.repeats
    .filter((s) => s.state === 'done')
    .map((s) => s.run.usage)
  const estimate = [...state.skill, ...state.script].some(
    (s) => s.run?.usage.costSource === 'estimate',
  )
  document.getElementById('model-note').textContent = [
    first ? `${first.model} · effort ${state.effort}.` : '',
    estimate ? 'Costs are estimates.' : '',
    'Exact: no ID missed and no extra ID. +n: extra IDs.',
    `Day ${state.repeatDay} ran ${setup.repeats} times in each mode. The totals do not include the ${setup.repeats - 1} extra skill runs${extra.length === setup.repeats - 1 ? ` (${cost(sumUsage(extra))})` : ''}.`,
  ]
    .filter(Boolean)
    .join(' ')

  const headline = document.getElementById('headline')
  headline.hidden = !a.done || !b.done
  headline.replaceChildren(...(a.done && b.done ? lead() : []))
}

/** The finding, built from this run, so it also says when an effect did not show. */
function lead() {
  const used = state.skill.filter((s) => s.run?.modelCalls > 0).length
  const free = state.script.filter((s) => s.run?.modelCalls === 0).length
  const out = [
    el(
      'strong',
      {},
      `The skill called the model on ${used} of ${DAYS} mornings. The saved script ran with no model on ${free}.`,
    ),
  ]

  const day = setup.renameDay
  const renameRun = state.script[day - 1].run
  const broke = renameRun?.events?.find((e) => e.kind === 'run' && !e.ok)

  if (!renameRun?.events?.some((e) => e.kind === 'run')) {
    out.push(` No saved script ran on day ${day}.`)
  } else if (broke && renameRun.score?.exact) {
    out.push(
      ` On day ${day}, the renamed field stopped the script with one error${broke.line ? ` at line ${broke.line}` : ''}. One repair fixed it.`,
    )
  } else if (broke) {
    out.push(
      ` On day ${day}, the renamed field stopped the script. The repair did not give an exact brief.`,
    )
  } else if (!renameRun.score?.exact) {
    out.push(
      ` On day ${day}, the script did not stop at the renamed field. It gave a wrong brief with no error.`,
    )
  } else {
    out.push(` On day ${day}, the script read the renamed field with no error.`)
  }

  return out
}

// ── Day by day ─────────────────────────────────────────────────────────

function rightCell(slot) {
  if (slot.state === 'running' || slot.state === 'waiting') {
    return el('td', { class: 'num mx-muted' }, '…')
  }

  if (slot.state === 'failed') {
    return el('td', { class: 'num mx-bad' }, 'failed')
  }

  const r = slot.run
  if (!r.score) {
    return el(
      'td',
      { class: 'num' },
      el('span', { class: 'mx-bad', title: r.error }, 'no brief'),
    )
  }

  const wrong = [
    r.score.missed.length ? `missed ${r.score.missed.join(' ')}` : null,
    r.score.extra.length ? `extra ${r.score.extra.join(' ')}` : null,
  ].filter(Boolean)

  return el(
    'td',
    { class: 'num' },
    el(
      'span',
      { class: r.score.exact ? 'mx-good' : 'mx-bad' },
      `${r.score.correct}/${r.score.expected}${r.score.extra.length ? ` +${r.score.extra.length}` : ''}`,
    ),
    wrong.length ? el('span', { class: 'sv-wrong' }, wrong.join(' · ')) : null,
  )
}

const numCells = (slot) =>
  slot.state === 'done'
    ? [
        el('td', { class: 'num' }, String(slot.run.modelCalls)),
        el('td', { class: 'num' }, cost(slot.run.usage)),
        el('td', { class: 'num' }, time(slot.run.ms)),
      ]
    : [0, 1, 2].map(() =>
        el(
          'td',
          { class: 'num mx-muted' },
          slot.state === 'failed' ? '—' : '…',
        ),
      )

function scriptCell(slot) {
  if (slot.state === 'running' || slot.state === 'waiting') {
    return el(
      'td',
      { class: 'mx-muted' },
      slot.state === 'running' ? 'running…' : 'waiting',
    )
  }

  if (slot.state === 'failed') {
    return el('td', { class: 'mx-bad' }, slot.error.message)
  }

  const parts = (slot.run.events ?? [])
    .map((e) => {
      if (e.kind === 'write') {
        return el(
          'span',
          { class: e.ok ? '' : 'mx-bad' },
          e.ok ? 'Written' : 'Not written',
        )
      }

      if (e.kind === 'repair') {
        return el(
          'span',
          { class: e.ok ? 'sv-repair' : 'mx-bad' },
          e.ok ? 'Repaired' : 'Repair failed',
        )
      }

      return e.ok
        ? null
        : el(
            'span',
            { class: 'mx-bad' },
            'Failed: ',
            el('code', {}, e.error),
            e.line ? ` at line ${e.line}` : '',
          )
    })
    .filter(Boolean)

  return el(
    'td',
    { class: 'sv-script-cell' },
    parts.length
      ? parts.flatMap((p, i) => [
          i ? el('span', { class: 'mx-muted' }, ' → ') : null,
          p,
        ])
      : el('span', { class: 'mx-muted' }, 'Ran, no model'),
  )
}

function renderDays() {
  document.getElementById('days').replaceChildren(
    ...Array.from({ length: DAYS }, (_, i) => {
      const day = i + 1
      const a = state.skill[i]
      const b = state.script[i]

      return el(
        'tr',
        { class: day === setup.renameDay ? 'sv-rename' : '' },
        el(
          'th',
          { scope: 'row' },
          `Day ${day}`,
          el(
            'span',
            { class: 'sv-sub' },
            day === setup.renameDay
              ? `${setup.rename.from} → ${setup.rename.to}`
              : setup.dates[i],
          ),
        ),
        rightCell(a),
        ...numCells(a),
        rightCell(b),
        ...numCells(b),
        scriptCell(b),
      )
    }),
  )
}

// ── The script and its repairs ─────────────────────────────────────────

function renderScript() {
  const first = state.script[0]
  if (first.state !== 'done') {
    return
  }

  document.getElementById('script-box').hidden = false

  const lines = first.run.code ? first.run.code.trim().split('\n').length : 0
  document
    .getElementById('script')
    .replaceChildren(
      first.run.code
        ? el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el('span', { class: 'mx-label' }, 'Script from day 1'),
              el(
                'span',
                { class: 'mx-muted mx-small' },
                `brief(data) · ${plural(lines, 'line')}`,
              ),
            ),
            codeBlock(first.run.code, 'js'),
          )
        : el(
            'p',
            { class: 'mx-bad' },
            'The agent saved no working script on day 1. Each later morning starts again with the agent.',
          ),
    )

  document.getElementById('repairs').replaceChildren(
    ...state.script
      .filter((s) => s.state === 'done' && s.run.repair)
      .map((s) => {
        const failed = s.run.events.find((e) => e.kind === 'run' && !e.ok)

        return el(
          'div',
          { class: 'mx-stack sv-repair-box' },
          el(
            'div',
            { class: 'mx-section-head' },
            el('h3', { class: 'mx-h3' }, `Repair on day ${s.run.day}`),
            el(
              'p',
              {},
              'The script stopped with ',
              el('code', {}, failed?.error ?? 'an error'),
              failed?.line ? ` at line ${failed.line}` : '',
              `. The agent got the error and the code one time. It removed ${plural(s.run.repair.removed, 'line')} and added ${s.run.repair.added}.`,
            ),
          ),
          codeBlock(s.run.repair.text, 'diff'),
        )
      }),
  )
}

// ── Folded: every model call ───────────────────────────────────────────

function callsFold(name, runs) {
  const steps = runs.flatMap(({ label, run }) =>
    run.steps.map((s) => ({ label, ...s })),
  )
  const usage = sumUsage(steps.map((s) => s.step.usage))

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, name),
      el(
        'span',
        { class: 'mx-muted mx-small' },
        steps.length
          ? `${plural(steps.length, 'model call')} · ${usageText(usage)}`
          : 'no model calls',
      ),
    ),
    el(
      'div',
      { class: 'sv-pad mx-stack' },
      steps.map(({ label, phase, step }) =>
        el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el(
              'span',
              {},
              `${label} · ${phase === 'skill' ? '' : `${phase === 'write' ? 'write' : 'repair'} · `}step ${step.number}`,
            ),
            el(
              'span',
              { class: 'mx-muted mx-small' },
              `${step.calls.length ? step.calls.map((c) => c.name).join(', ') : 'answer'} · ${usageText(step.usage)}`,
            ),
          ),
          el(
            'div',
            { class: 'sv-pad' },
            requestResponse(step.request, step.response),
          ),
        ),
      ),
    ),
  )
}

function renderCalls() {
  const done = (slots, label) =>
    slots
      .map((s, i) =>
        s.state === 'done' ? { label: label(s, i), run: s.run } : null,
      )
      .filter(Boolean)

  const skillRuns = [
    ...done(state.skill, (s) => `Day ${s.run.day}`),
    ...done(state.repeats, (s, i) => `Day ${s.run.day}, run ${i + 2}`),
  ]
  const scriptRuns = done(state.script, (s) => `Day ${s.run.day}`)

  document.getElementById('calls-box').hidden = false
  document
    .getElementById('calls')
    .replaceChildren(
      callsFold('A. Skill only', skillRuns),
      callsFold('B. Saved script', scriptRuns),
    )
}

function render() {
  renderTotals()
  renderDays()
  renderScript()

  if (
    [...state.skill, ...state.repeats, ...state.script].every(
      (s) => s.state === 'done' || s.state === 'failed',
    )
  ) {
    renderCalls()
  }
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const input = { effort, repeatDay, ...picker.value() }
  const slot = () => ({ state: 'running' })
  state = {
    effort,
    repeatDay,
    skill: Array.from({ length: DAYS }, slot),
    repeats: Array.from({ length: setup.repeats - 1 }, slot),
    script: Array.from({ length: DAYS }, () => ({ state: 'waiting' })),
  }

  for (const box of ['empty', 'script-box', 'calls-box']) {
    document.getElementById(box).hidden = true
  }
  for (const box of ['result', 'days-box']) {
    document.getElementById(box).hidden = false
  }

  render()

  const settle = async (target, work) => {
    try {
      target.run = await work()
      target.state = 'done'
    } catch (error) {
      target.state = 'failed'
      target.error = error
      showError(notice, error)
    }

    if (id === batch) {
      render()
    }
  }

  // A: the mornings do not depend on each other, so they run at the same time.
  const skillLane = Promise.all([
    ...state.skill.map((s, i) =>
      settle(s, () => call('skill', { ...input, day: i + 1 })),
    ),
    ...state.repeats.map((s) =>
      settle(s, () => call('skill', { ...input, day: repeatDay })),
    ),
  ])

  // B: in order, because each morning runs the script the morning before left.
  const scriptLane = (async () => {
    let runId
    for (let day = 1; day <= DAYS; day++) {
      const target = state.script[day - 1]
      target.state = 'running'
      if (id === batch) {
        render()
      }

      await settle(target, () => call('script', { ...input, day, runId }))

      if (target.state !== 'done') {
        // Without the run's script, the later mornings cannot run.
        for (const later of state.script.slice(day)) {
          Object.assign(later, {
            state: 'failed',
            error: new Error('Not run: an earlier morning failed.'),
          })
        }
        break
      }

      runId = target.run.runId
    }
  })()

  await busy(button, 'Running…', () => Promise.all([skillLane, scriptLane]))
  if (id === batch) {
    render()
  }
}

function seg(container, values, current, onPick, label = String) {
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
        label(value),
      ),
    ),
  )
}

// ── Setup ──────────────────────────────────────────────────────────────

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const calls = 2 * (DAYS + setup.repeats - 1) + 4
document.getElementById('empty').textContent =
  `Press Run. About ${calls} model calls in both modes, under 1 cent. It takes about a minute.`
document
  .getElementById('rename-note')
  .replaceChildren(
    `On day ${setup.renameDay}, the tracker export renames a field: issues have `,
    el('code', {}, setup.rename.to),
    ' instead of ',
    el('code', {}, setup.rename.from),
    '.',
  )
document.getElementById('skill-note').textContent =
  `daily-brief.md · ${plural(setup.skill.trim().split('\n').length, 'line')} · the rules of both modes`
document
  .getElementById('skill')
  .replaceChildren(codeBlock(setup.skill.trim(), 'md'))
document
  .getElementById('instructions')
  .replaceChildren(
    el('span', { class: 'mx-small' }, 'A. Skill only'),
    codeBlock(setup.instructions.skill, 'md'),
    el('span', { class: 'mx-small' }, 'B. Saved script'),
    codeBlock(setup.instructions.script, 'md'),
  )
const counts = (d) =>
  `${d.issues.length} issues, ${d.pull_requests.length} pull requests, ${d.deploys.length} deploys, ${d.meetings.length} meetings`
document.getElementById('data-note').textContent =
  `${DAYS} mornings · ${counts(setup.mornings[0].data)} on day 1 · answer key with each`
document
  .getElementById('data')
  .replaceChildren(
    ...setup.mornings.map((m) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', {}, `Day ${m.day} · ${m.date}`),
          el('span', { class: 'mx-muted mx-small' }, counts(m.data)),
        ),
        el(
          'div',
          { class: 'sv-pad mx-stack' },
          el('span', { class: 'mx-small' }, 'Answer key'),
          codeBlock(JSON.stringify(m.key, null, 2), 'json'),
          el('span', { class: 'mx-small' }, 'What the tools return'),
          codeBlock(JSON.stringify(m.data, null, 2), 'json'),
        ),
      ),
    ),
  )

seg(document.getElementById('efforts'), setup.efforts, effort, (v) => {
  effort = v
})
seg(
  document.getElementById('repeat-day'),
  Array.from({ length: DAYS }, (_, i) => i + 1),
  repeatDay,
  (v) => {
    repeatDay = v
  },
  (v) => `Day ${v}`,
)
document.getElementById('repeat-hint').textContent =
  `This morning runs ${setup.repeats} times in each mode. Code counts the distinct briefs.`
button.addEventListener('click', start)
