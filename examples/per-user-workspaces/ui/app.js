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
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const scores = document.getElementById('scores')
const details = document.getElementById('details')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const inside = (resolved) =>
  resolved === setup.root || resolved.startsWith(`${setup.root}/`)
// Table fields, in the order of setup.modes.
const COLUMNS = ['instruction', 'prefix', 'resolvedPath']
const modeLabel = (id) => setup.modes.find((mode) => mode.id === id).label

// The path table: free, filled on load.
document
  .getElementById('modes')
  .append(
    ...setup.modes.map((mode) =>
      el('li', {}, el('b', {}, mode.label), ': ', mode.rule),
    ),
  )
document
  .getElementById('paths-head')
  .append(
    el(
      'tr',
      {},
      el('th', {}, 'Path asked for'),
      el('th', {}, 'Leads to'),
      ...setup.modes.map((mode) => el('th', {}, mode.label)),
    ),
  )
document.getElementById('paths').append(
  ...setup.table.map((row) => {
    const outside = !inside(row.resolved)

    return el(
      'tr',
      {},
      el(
        'td',
        {},
        el('code', {}, row.path),
        el('div', { class: 'mx-small mx-muted' }, row.label),
      ),
      el(
        'td',
        {},
        el('code', { class: outside ? 'mx-bad' : null }, row.resolved),
      ),
      ...COLUMNS.map((key) =>
        el(
          'td',
          {},
          row[key]
            ? el('span', { class: outside ? 'mx-bad' : 'mx-good' }, 'Allowed')
            : el('span', { class: 'mx-muted' }, 'Denied'),
        ),
      ),
    )
  }),
)

const outsideRows = setup.table.filter((row) => !inside(row.resolved))
const prefixLeaks = outsideRows.filter((row) => row.prefix).length
document
  .getElementById('table-verdict')
  .append(
    el(
      'b',
      {},
      `${prefixLeaks} of ${outsideRows.length} paths into another user’s workspace pass the string-prefix check.`,
    ),
    ` Only the resolved-path check denies all ${outsideRows.length}.`,
  )

document.getElementById('scenario-size').textContent =
  `${plural(setup.tasks.length, 'task')}, ${plural(Object.keys(setup.files).length, 'file')}`
document
  .getElementById('scenario')
  .append(
    ...setup.tasks.map((task) =>
      el('p', {}, el('b', {}, task.title), ': ', task.prompt),
    ),
    codeBlock(prettyJson(setup.files), 'json'),
  )

// The model runs.
function callView(item) {
  const block = codeBlock(item.output)
  block.setAttribute('data-wrap', '')

  return el(
    'div',
    { class: 'pw-call' },
    el(
      'div',
      {},
      el('code', {}, `${item.name}(${item.arguments})`),
      item.error
        ? el('span', { class: 'mx-label mx-bad' }, ' · tool error')
        : null,
    ),
    block,
  )
}

function taskView(task) {
  return el(
    'div',
    { class: 'pw-task mx-stack' },
    el('b', {}, task.title),
    modelText(
      task.text ||
        (task.end === 'step_limit'
          ? 'The agent stopped at the step limit.'
          : '(No answer)'),
    ),
    ...task.steps.flatMap((step) => step.calls.map(callView)),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${plural(task.steps.length, 'request')} · ${usageText(task.usage)}`,
    ),
    ...task.steps.map((step) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el(
            'span',
            { class: 'mx-label' },
            `Request and response · step ${step.number}`,
          ),
        ),
        requestResponse(step.request, step.response),
      ),
    ),
  )
}

function modeView(result) {
  const calls = result.runs.reduce(
    (n, task) => n + task.steps.reduce((m, step) => m + step.calls.length, 0),
    0,
  )
  const requests = result.runs.reduce((n, task) => n + task.steps.length, 0)

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `${modeLabel(result.mode)} · tool calls`,
      ),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(calls, 'call')}, ${plural(requests, 'request')}`,
      ),
    ),
    el(
      'div',
      { class: 'pw-detail mx-stack' },
      ...result.runs.map(taskView),
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, 'Files after both tasks'),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            plural(Object.keys(result.files).length, 'file'),
          ),
        ),
        codeBlock(prettyJson(result.files), 'json'),
      ),
    ),
  )
}

function scoreRow(result) {
  const { score, usage } = result
  const breaches = score.crossReads + score.crossWrites

  return el(
    'tr',
    {},
    el('td', {}, modeLabel(result.mode)),
    el('td', { class: 'num' }, `${score.tasksDone} of ${score.tasksTotal}`),
    el(
      'td',
      { class: `num ${breaches ? 'mx-bad' : ''}` },
      breaches
        ? `${plural(score.crossReads, 'read')}, ${plural(score.crossWrites, 'write')}`
        : '0',
    ),
    el('td', { class: 'num' }, String(score.denied)),
    el(
      'td',
      { class: 'num' },
      `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`,
    ),
  )
}

function verdict(results) {
  const attempts = results.reduce(
    (n, result) =>
      n + result.accesses.filter((event) => event.otherUser).length,
    0,
  )

  if (!attempts) {
    return [
      el('b', {}, 'The model asked for no other user’s file in any mode.'),
      ' The path table above shows what each mode would allow.',
    ]
  }

  const breached = results.filter(
    (result) => result.score.crossReads + result.score.crossWrites > 0,
  )
  const safe = results
    .filter((result) => !breached.includes(result))
    .map((result) => {
      const asked = result.accesses.filter((event) => event.otherUser).length
      return asked
        ? ` ${modeLabel(result.mode)} denied all ${plural(asked, 'request')}.`
        : ` In ${modeLabel(result.mode)} mode, the model asked for no other user’s file.`
    })

  const head = breached.length
    ? `Ana’s agent reached another user’s files in ${breached.length} of ${results.length} modes: ${breached.map((result) => modeLabel(result.mode)).join(', ')}.`
    : 'Ana’s agent reached no other user’s file.'

  return [el('b', {}, head), ...safe]
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  showError(notice, null)
  scores.replaceChildren()
  details.replaceChildren()
  document.getElementById('empty').hidden = true
  document.getElementById('score-box').hidden = false

  const runVerdict = document.getElementById('run-verdict')
  runVerdict.hidden = true
  const results = []

  try {
    for (const mode of setup.modes) {
      const pending = el(
        'tr',
        {},
        el('td', { colspan: '5', class: 'mx-muted' }, `Running ${mode.label}…`),
      )
      scores.append(pending)

      try {
        const result = await call('run', { mode: mode.id, ...picker.value() })
        results.push(result)
        pending.replaceWith(scoreRow(result))
        details.append(modeView(result))
      } catch (error) {
        pending.remove()
        showError(notice, error)
        break
      }
    }

    if (results.length === setup.modes.length) {
      runVerdict.replaceChildren(...verdict(results))
      runVerdict.hidden = false
    }
  } finally {
    button.disabled = false
  }
})
