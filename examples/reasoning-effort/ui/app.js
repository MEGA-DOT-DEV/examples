import {
  call,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

// Rows run side by side, a few at a time, so they fill as they finish.
const PARALLEL = 3

const taskBox = document.getElementById('task')
const expectedBox = document.getElementById('expected')
const extraBox = document.getElementById('extra')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const tbody = document.getElementById('rows')

const config = await call('presets')
let runs = 1
let rows = []
let selected = null
// The correct answer of the current batch, for the headline.
let expected = null

function setTask(task) {
  taskBox.value = task.text
  expectedBox.value = String(task.answer)
}

function readExpected() {
  const value = Number(expectedBox.value.trim().replace(/,/g, ''))
  return expectedBox.value.trim() && Number.isFinite(value) ? value : null
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

const levelCount = () =>
  config.efforts.length + (extraBox.checked ? config.extra.length : 0)
const runLabel = () => `Run ${levelCount()} levels`

// Before the first run: what to press and how many requests it sends.
function renderEmpty() {
  if (!button.disabled) {
    button.textContent = runLabel()
  }

  const requests = levelCount() * runs
  document
    .getElementById('empty')
    .replaceChildren(
      'Press ',
      el('b', {}, runLabel()),
      `. ${requests} requests. `,
      extraBox.checked
        ? 'xhigh and max can cost much more than the other levels.'
        : 'Usually under 1 cent with the default model.',
    )
}

/** The headline: how many levels were correct, the lowest correct level, and what the highest level spent. */
function renderHeadline() {
  const text = document.getElementById('headline-text')
  const pending = rows.some(
    (row) => row.state === 'waiting' || row.state === 'running',
  )

  const levels = [...new Set(rows.map((row) => row.effort))].map((effort) => {
    const mine = rows.filter((row) => row.effort === effort)
    const done = mine.filter((row) => row.result?.supported)
    const avg = (pick) =>
      done.reduce((sum, row) => sum + pick(row.result), 0) / done.length
    const costs = done.map((row) => row.result.usage.cost)

    return {
      effort,
      done,
      finished: mine.every(
        (row) => row.state === 'done' || row.state === 'failed',
      ),
      unsupported: mine.some((row) => row.result && !row.result.supported),
      correct:
        done.length === mine.length && done.every((row) => row.result.correct),
      reasoning: Math.round(avg((r) => r.usage.reasoningTokens)),
      ms: avg((r) => r.ms),
      cost: costs.every((c) => c != null)
        ? costs.reduce((a, b) => a + b, 0) / done.length
        : null,
    }
  })

  const answered = levels.filter((l) => l.done.length)
  if (!answered.length) {
    return text.replaceChildren(
      pending
        ? `Running ${rows.length} requests…`
        : 'No level returned an answer.',
    )
  }

  const many = Math.max(...rows.map((row) => row.run)) > 1
  const every = many ? ' in every run' : ''
  const average = many ? ' on average' : ''
  const spent = (l) =>
    `${l.reasoning.toLocaleString('en')} reasoning tokens and ${seconds(l.ms)}`

  const correct = answered.filter((l) => l.finished && l.correct)
  const parts = [
    `${pending ? 'So far, ' : ''}${correct.length} of ${answered.length} levels answered ${expected} correctly${every}.`,
  ]

  const codes = (list) =>
    list.flatMap((l, i) => [i ? ', ' : '', el('code', {}, l.effort)])

  const wrong = answered.filter((l) => l.finished && !l.correct)
  if (wrong.length) {
    const level = wrong.length === 1 ? ' Level ' : ' Levels '
    if (many) {
      parts.push(
        level,
        ...codes(wrong),
        ` ${wrong.length === 1 ? 'was' : 'were'} not correct in every run.`,
      )
    } else {
      const given = wrong.map((l) => l.done[0]?.result.answer ?? '—').join(', ')
      parts.push(
        level,
        ...codes(wrong),
        ` gave ${wrong.length === 1 ? 'a wrong answer' : 'wrong answers'} (${given}).`,
      )
    }
  }

  const lowest = correct[0]
  if (lowest) {
    parts.push(
      ' The lowest correct level is ',
      el('code', {}, lowest.effort),
      `: ${spent(lowest)}${average}.`,
    )
  }

  const top = answered.at(-1)
  if (top !== lowest) {
    const cost =
      top.cost == null
        ? ''
        : ` for ${formatCost(top.cost)}${top.done.some((row) => row.result.usage.costSource === 'estimate') ? ' (est.)' : ''}`

    parts.push(
      ' Level ',
      el('code', {}, top.effort),
      ` used ${spent(top)}${cost}${average}.`,
    )
  }

  const unsupported = levels.filter((l) => l.unsupported)
  if (unsupported.length) {
    parts.push(
      ` This model does not support ${unsupported.length === 1 ? 'level' : 'levels'} `,
      ...codes(unsupported),
      '.',
    )
  }

  text.replaceChildren(...parts)
}

function resultCell(row) {
  if (row.state === 'waiting') {
    return el('td', { colspan: 2, class: 'mx-muted' }, 'waiting')
  }
  if (row.state === 'running') {
    return el('td', { colspan: 2, class: 'mx-muted re-running' }, 'running…')
  }
  if (row.state === 'failed') {
    return el(
      'td',
      { colspan: 2, class: 'mx-bad' },
      `failed: ${row.error.message}`,
    )
  }

  const r = row.result
  if (!r.supported) {
    return el(
      'td',
      { colspan: 2, class: 'mx-muted', title: r.error },
      'not supported by this model',
    )
  }

  const stopped =
    r.status === 'incomplete'
      ? el(
          'span',
          { class: 'mx-small mx-muted' },
          ` stopped at the ${r.maxOutputTokens}-token limit`,
        )
      : null

  return [
    el(
      'td',
      {},
      r.correct
        ? el('span', { class: 'mx-good' }, '✓ correct')
        : el('span', { class: 'mx-bad' }, '✗ wrong'),
      stopped,
    ),
    el('td', { class: 'num' }, r.answer === null ? '—' : String(r.answer)),
  ]
}

function render() {
  const most = Math.max(
    1,
    ...rows.map((row) => row.result?.usage?.reasoningTokens ?? 0),
  )

  tbody.replaceChildren(
    ...rows.map((row) => {
      const u = row.result?.supported ? row.result.usage : null
      const reasoning = u
        ? el(
            'span',
            { class: 're-reasoning' },
            el(
              'span',
              { class: 'mx-meter mx-meter--accent' },
              el('i', {
                style: { width: `${(u.reasoningTokens / most) * 100}%` },
              }),
            ),
            el('span', { class: 'num' }, String(u.reasoningTokens)),
          )
        : '—'

      const cost = u
        ? u.cost == null
          ? '—'
          : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`
        : '—'

      const show =
        row.result || row.state === 'failed'
          ? el(
              'button',
              {
                class: 'mx-btn mx-btn--small',
                type: 'button',
                'aria-pressed': String(selected === row),
                onclick: () => {
                  selected = row
                  render()
                },
              },
              'Show',
            )
          : null

      return el(
        'tr',
        { class: selected === row ? 're-selected' : '' },
        el('td', {}, el('code', {}, row.effort)),
        el('td', { class: 'num' }, String(row.run)),
        el('td', {}, reasoning),
        el('td', { class: 'num' }, u ? String(u.outputTokens) : '—'),
        el('td', { class: 'num' }, u ? seconds(row.result.ms) : '—'),
        el('td', { class: 'num' }, cost),
        resultCell(row),
        el('td', {}, show),
      )
    }),
  )

  renderTotals()
  renderHeadline()
  renderDetail()
}

function renderTotals() {
  const done = rows.filter((row) => row.result?.supported)
  if (!done.length) {
    document.getElementById('totals').textContent = ''
    return
  }

  const levels = [...new Set(rows.map((row) => row.effort))]
    .map((effort) => {
      const mine = rows.filter(
        (row) => row.effort === effort && row.result?.supported,
      )
      return mine.length
        ? `${effort} ${mine.filter((row) => row.result.correct).length}/${mine.length}`
        : null
    })
    .filter(Boolean)

  const costs = done.map((row) => row.result.usage.cost)
  const cost = costs.every((c) => c != null)
    ? formatCost(costs.reduce((a, b) => a + b, 0))
    : 'unknown'
  const estimate = done.some(
    (row) => row.result.usage.costSource === 'estimate',
  )
    ? ' est.'
    : ''
  const output = done.reduce(
    (sum, row) => sum + row.result.usage.outputTokens,
    0,
  )

  // With one run per level, the Result column already says it.
  const correct =
    Math.max(...rows.map((row) => row.run)) > 1
      ? `Correct: ${levels.join(' · ')}. `
      : ''
  document.getElementById('totals').textContent =
    `${correct}Total: ${output} output tokens, ${cost}${estimate || '.'}`

  const first = done[0].result
  document.getElementById('meta').textContent =
    `${first.provider} · ${first.model}`
}

function renderDetail() {
  const box = document.getElementById('detail')
  box.hidden = !selected
  if (!selected) {
    return
  }

  const r = selected.result
  document.getElementById('detail-title').textContent =
    `Model text · ${selected.effort} · run ${selected.run}`
  document.getElementById('detail-usage').textContent = r?.usage
    ? usageText(r.usage)
    : ''

  const text =
    selected.state === 'failed'
      ? selected.error.message
      : !r.supported
        ? r.error
        : r.text || '(no text: the model used the whole limit on reasoning)'

  document
    .getElementById('detail-text')
    .replaceChildren(modelText(text, 'mx-output mx-panel'))
  document
    .getElementById('detail-raw')
    .replaceChildren(r ? requestResponse(r.request, r.response) : '')
}

async function runRow(row, input) {
  row.state = 'running'
  render()

  try {
    row.result = await call('run', { ...input, effort: row.effort })
    row.state = 'done'
  } catch (error) {
    // A missing key stops everything: show the setup hint once, above the table.
    if (error.missingKey) {
      showError(notice, error)
    }
    row.state = 'failed'
    row.error = error
  }

  render()
}

async function runAll() {
  if (button.disabled) {
    return
  }

  const task = taskBox.value.trim()
  expected = readExpected()

  if (!task) {
    return showError(notice, new Error('Type a task first.'))
  }
  if (expected === null) {
    return showError(
      notice,
      new Error('Type the correct answer as a number, for example 168.'),
    )
  }
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }
  notice.replaceChildren()

  const efforts = [...config.efforts, ...(extraBox.checked ? config.extra : [])]
  rows = efforts.flatMap((effort) =>
    Array.from({ length: runs }, (_, i) => ({
      effort,
      run: i + 1,
      state: 'waiting',
    })),
  )

  selected = null
  document.getElementById('meta').textContent = ''
  document.getElementById('empty').hidden = true
  document.getElementById('headline').hidden = false
  document.getElementById('results').hidden = false

  render()

  const input = { task, expected, ...picker.value() }
  const queue = [...rows]

  button.disabled = true
  button.textContent = 'Running…'

  try {
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (queue.length) {
          await runRow(queue.shift(), input)
        }
      }),
    )
  } finally {
    button.disabled = false
    button.textContent = runLabel()
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

setTask(config.tasks[0])
taskBox.maxLength = config.maxTask
document
  .getElementById('presets')
  .append(
    ...config.tasks.map((task) =>
      el(
        'button',
        { class: 'mx-chip', type: 'button', onclick: () => setTask(task) },
        task.label,
      ),
    ),
  )

document.getElementById('runs').append(
  ...Array.from({ length: config.maxRuns }, (_, i) => i + 1).map((n) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(n === runs),
        onclick: (event) => {
          runs = n
          renderEmpty()
          for (const b of event.currentTarget.parentElement.children) {
            b.setAttribute('aria-pressed', String(b === event.currentTarget))
          }
        },
      },
      String(n),
    ),
  ),
)

extraBox.addEventListener('change', () => {
  document.getElementById('extra-warning').hidden = !extraBox.checked
  renderEmpty()
})

renderEmpty()
button.addEventListener('click', runAll)

expectedBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    runAll()
  }
})

taskBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    runAll()
  }
})
