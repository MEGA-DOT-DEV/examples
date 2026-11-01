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

const task = document.getElementById('task')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const summary = document.getElementById('summary')
const verdict = document.getElementById('verdict')
const tableBox = document.getElementById('table-box')
const rows = document.getElementById('rows')
const runs = document.getElementById('runs')

const settings = await call('setup')
const label = Object.fromEntries(settings.modes.map((m) => [m.id, m.label]))
// One sentence per method: how the model gets a tool schema. Tool names are the lesson, so they show as code.
const code = (text) => el('code', {}, text)
const how = {
  'all-schemas': () => [
    `Every request sends all ${settings.catalogSize} tool schemas.`,
  ],
  'tool-search': () => [
    'The model sees tool names only. ',
    code('tool_search'),
    ' adds matching schemas to the next request.',
  ],
  files: () => [
    'The model lists ',
    code('tools/'),
    ', reads a schema file, then calls ',
    code('invoke_tool'),
    '.',
  ],
}
document.getElementById('title').textContent =
  `Find one tool among ${settings.catalogSize}`
task.replaceChildren(
  ...settings.tasks.map((item, index) =>
    el('option', { value: String(index) }, item.query),
  ),
)
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const n = (value) => Number(value).toLocaleString('en-US')
// A short tool result stays open; a long one is folded, and its summary says how long.
const SHORT_LINES = 4

function resultView(action) {
  const text = prettyJson(action.result)
  const lines = text.split('\n').length
  const block = codeBlock(text, 'json')

  if (lines <= SHORT_LINES) {
    return block
  }

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Tool result'),
      el('span', { class: 'mx-small mx-muted' }, plural(lines, 'line')),
    ),
    block,
  )
}

function actionView(action) {
  const status = action.target
    ? el('span', { class: 'mx-good' }, 'right tool and arguments')
    : action.valid
      ? null
      : el('span', { class: 'mx-bad' }, action.errors.join('; '))

  return el(
    'div',
    { class: 'ts-action' },
    el(
      'p',
      {},
      el('code', {}, action.name),
      ' ',
      el('code', { class: 'ts-args' }, JSON.stringify(action.args)),
      status ? ' → ' : null,
      status,
    ),
    resultView(action),
  )
}

function stepView(step) {
  return el(
    'li',
    { class: 'ts-step' },
    el(
      'div',
      { class: 'mx-spread' },
      el(
        'span',
        { class: 'mx-label' },
        `Request ${step.number} · ${plural(step.toolsAvailable.length, 'schema')} sent`,
      ),
      el('span', { class: 'mx-small mx-muted' }, usageText(step.usage)),
    ),
    ...step.actions.map(actionView),
    step.actions.length
      ? null
      : el(
          'p',
          { class: 'mx-small' },
          step.text
            ? `The model answered without a tool call: ${step.text}`
            : 'The model stopped without a tool call.',
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
          `Request and response · request ${step.number}`,
        ),
      ),
      requestResponse(step.request, step.response),
    ),
  )
}

function runView(mode, outcome) {
  const head = el(
    'div',
    { class: 'mx-section-head' },
    el('h4', { class: 'ts-run-title' }, label[mode]),
    el('p', {}, how[mode]()),
  )

  if (outcome.status === 'rejected') {
    const box = el('div')
    showError(box, outcome.reason)
    return el('article', { class: 'mx-plate ts-run' }, head, box)
  }

  return el(
    'article',
    { class: 'mx-plate ts-run' },
    head,
    el('ol', { class: 'ts-steps' }, ...outcome.value.steps.map(stepView)),
  )
}

function rowView(mode, outcome) {
  if (outcome.status === 'rejected') {
    return el(
      'tr',
      {},
      el('td', {}, label[mode]),
      el('td', { colspan: '4' }),
      el('td', { class: 'mx-bad' }, 'Error'),
    )
  }

  const result = outcome.value
  const costs = result.steps.map((s) => s.usage.cost)
  const cost = costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0)
  const estimate = result.steps.some((s) => s.usage.costSource === 'estimate')

  return el(
    'tr',
    {},
    el('td', {}, label[mode]),
    el(
      'td',
      { class: 'num' },
      result.steps.map((s) => s.toolsAvailable.length).join(' → '),
    ),
    el('td', { class: 'num' }, String(result.steps.length)),
    el(
      'td',
      { class: 'num' },
      `${n(result.inputTokens)}${result.cachedTokens ? ` (${n(result.cachedTokens)} cached)` : ''}`,
    ),
    el(
      'td',
      { class: 'num' },
      `${formatCost(cost)}${estimate && cost != null ? ' est.' : ''}`,
    ),
    el(
      'td',
      { class: result.correct ? 'mx-good' : 'mx-bad' },
      result.correct ? 'Right tool' : 'Not found',
    ),
  )
}

// The point in one line: did each method find the tool, and what did it cost in input tokens against sending every schema.
function verdictText(outcomes) {
  const done = settings.modes.map((m, i) => ({
    mode: m.id,
    result: outcomes[i].status === 'fulfilled' ? outcomes[i].value : null,
  }))

  const missed = done
    .filter((d) => !d.result?.correct)
    .map((d) => label[d.mode])
  const found = missed.length
    ? `${new Intl.ListFormat('en').format(missed)} did not call the right tool.`
    : 'All 3 methods called the right tool with the right arguments.'

  const base = done.find((d) => d.mode === 'all-schemas')?.result
  if (!base?.inputTokens) {
    return found
  }

  const shares = done
    .filter((d) => d.mode !== 'all-schemas' && d.result)
    .map(
      (d) =>
        `${label[d.mode]} ${Math.round((100 * d.result.inputTokens) / base.inputTokens)}%`,
    )

  return shares.length
    ? `${found} Input tokens, compared with ${label['all-schemas']}: ${shares.join(', ')}.`
    : found
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  button.textContent = 'Running…'
  showError(notice, null)
  verdict.hidden = true
  tableBox.hidden = true
  runs.replaceChildren()
  summary.textContent = 'The three methods run at the same time…'

  try {
    const input = { task: Number(task.value), ...picker.value() }
    const outcomes = await Promise.allSettled(
      settings.modes.map((m) => call('compare', { ...input, mode: m.id })),
    )

    const failed = outcomes.find((o) => o.status === 'rejected')
    if (failed && outcomes.every((o) => o.status === 'rejected')) {
      showError(notice, failed.reason)
      summary.textContent =
        'No method finished. Fix the error above and run again.'
      return
    }

    summary.textContent =
      'Each row is one run of the task. Input tokens add up all requests of the run.'
    verdict.textContent = verdictText(outcomes)
    verdict.hidden = false

    rows.replaceChildren(
      ...settings.modes.map((m, i) => rowView(m.id, outcomes[i])),
    )
    tableBox.hidden = false

    runs.replaceChildren(
      ...settings.modes.map((m, i) => runView(m.id, outcomes[i])),
    )
  } finally {
    button.disabled = false
    button.textContent = 'Run all three'
  }
})
