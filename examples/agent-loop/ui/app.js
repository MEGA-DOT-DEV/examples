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

const PRESETS = [
  [
    'Launch deadline',
    'How many days are left until the deadline in my launch plan note?',
  ],
  ['Q4 budget', 'What is the total of my Q4 budget?'],
  [
    'Offsite',
    'How many days do I have left to book the train for the offsite?',
  ],
  ['No tool needed', 'Say hello in one short sentence.'],
]

const taskBox = document.getElementById('task')
const stepsBox = document.getElementById('max-steps')
const runButton = document.getElementById('run')
const stopButton = document.getElementById('stop')
const notice = document.getElementById('notice')
const headline = document.getElementById('headline')
const trace = document.getElementById('trace')
let maxAllowed = 20
let stopRequested = false

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The output as pretty JSON when it is JSON, else as text. */
function outputText(output) {
  try {
    return { text: prettyJson(JSON.parse(output)), lang: 'json' }
  } catch {
    return { text: output, lang: '' }
  }
}

// A long tool result is folded: the summary says how long it is. A short
// result or an error stays open: folding it saves no space and costs a click.
const SHORT_LINES = 4

function outputView(c) {
  const shown = outputText(c.output)
  const block = codeBlock(shown.text, shown.lang)

  // Long strings (a note's body) wrap instead of scrolling sideways.
  block.setAttribute('data-wrap', '')

  if (c.error) {
    return el(
      'div',
      { class: 'al-call-out' },
      el(
        'span',
        { class: 'mx-label mx-bad' },
        'Tool error, sent back to the model',
      ),
      block,
    )
  }

  if (shown.text.split('\n').length <= SHORT_LINES) {
    return el(
      'div',
      { class: 'al-call-out' },
      el('span', { class: 'mx-label' }, 'Tool result'),
      block,
    )
  }

  return el(
    'details',
    { class: 'mx-details al-result' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Tool result'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        plural(shown.text.split('\n').length, 'line'),
      ),
    ),
    block,
  )
}

function rawView(step) {
  return el(
    'details',
    { class: 'mx-details al-raw' },
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
  )
}

function callView(c) {
  return el(
    'div',
    { class: `al-call${c.error ? ' is-error' : ''}` },
    el(
      'div',
      { class: 'al-call-head' },
      el('span', { class: 'al-arrow', 'aria-hidden': 'true' }, '→'),
      el('code', { class: 'al-call-name' }, c.name),
      el('code', { class: 'al-call-args' }, c.arguments || '{}'),
      el('span', { class: 'mx-small mx-muted' }, `${c.ms} ms`),
    ),
    outputView(c),
  )
}

function stepView(step, end) {
  const answer = end === 'answer'
  const kind = answer
    ? 'text answer, the loop ends'
    : end === 'step_limit'
      ? `${plural(step.calls.length, 'tool call')}, the step limit stops the loop`
      : `${plural(step.calls.length, 'tool call')}, the loop goes on`

  return el(
    'li',
    { class: `al-step${answer ? ' is-end' : ''}` },
    el(
      'div',
      { class: 'al-rail' },
      el('span', { class: 'al-num' }, String(step.number)),
    ),
    el(
      'div',
      { class: 'al-body mx-stack' },
      el(
        'div',
        { class: 'mx-spread' },
        el('span', { class: 'mx-label al-kind' }, kind),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `${step.ms} ms · ${usageText(step.usage)}`,
        ),
      ),
      ...step.calls.map(callView),
      step.text && !answer
        ? el('p', { class: 'mx-small mx-muted al-aside' }, step.text)
        : null,
      answer
        ? modelText(step.text || '(no text)', 'mx-output al-answer')
        : null,
      step.status === 'incomplete'
        ? el(
            'p',
            { class: 'mx-small mx-bad' },
            'The reply reached max_output_tokens and was cut.',
          )
        : null,
      rawView(step),
    ),
  )
}

function pendingView(number) {
  return el(
    'li',
    { class: 'al-step is-pending' },
    el(
      'div',
      { class: 'al-rail' },
      el('span', { class: 'al-num' }, String(number)),
    ),
    el(
      'div',
      { class: 'al-body' },
      el('span', { class: 'mx-label' }, 'Waiting for the model…'),
    ),
  )
}

function readout(label, value) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, value),
  )
}

/** How the loop ended, in one sentence. */
function endText(steps, end, stopText) {
  const last = steps.length
  if (end === 'answer') {
    return last === 1
      ? 'The model answered with text in step 1, so the loop ended at once. It needed no tool.'
      : `The model answered with text in step ${last}, so the loop ended. The ${plural(last - 1, 'step')} before it called tools.`
  }

  if (end === 'step_limit') {
    return stopText
  }

  if (end === 'stopped') {
    return `You stopped the loop after ${plural(last, 'step')}, before the model answered.`
  }

  return `The loop stopped with an error after ${plural(last, 'step')}. The error is above.`
}

/** The headline: how the loop ended, then the totals of all steps. */
function renderHeadline(steps, end, stopText) {
  const sum = (key) => steps.reduce((n, s) => n + s.usage[key], 0)
  const costs = steps.map((s) => s.usage.cost)
  const cost = costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0)
  const estimate = steps.some((s) => s.usage.costSource === 'estimate')
  const inputs = steps.map((s) => s.usage.inputTokens)

  headline.replaceChildren(
    ...[
      el(
        'div',
        { class: `mx-callout${end === 'answer' ? '' : ' mx-callout--warn'}` },
        el('span', { class: 'mx-label' }, 'Result'),
        el('p', {}, endText(steps, end, stopText)),
      ),
      steps.length
        ? el(
            'div',
            { class: 'mx-readouts' },
            readout(
              'Tool calls',
              String(steps.reduce((n, s) => n + s.calls.length, 0)),
            ),
            readout('Input tokens', String(sum('inputTokens'))),
            readout('Output tokens', String(sum('outputTokens'))),
            readout(estimate ? 'Cost (est.)' : 'Cost', formatCost(cost)),
          )
        : null,
      steps.length > 1
        ? el(
            'p',
            { class: 'mx-small mx-muted al-note' },
            `Input tokens per step: ${inputs.join(' → ')}. Each step sends the whole conversation again.`,
          )
        : null,
    ].filter(Boolean),
  )
}

function readMaxSteps() {
  const n = Number(stepsBox.value)
  return Number.isInteger(n) && n >= 1 && n <= maxAllowed ? n : null
}

async function run() {
  const task = taskBox.value.trim()
  if (!task) {
    return showError(notice, new Error('Type a task first.'))
  }

  const maxSteps = readMaxSteps()
  if (!maxSteps) {
    return showError(
      notice,
      new Error(`The step limit is a whole number from 1 to ${maxAllowed}.`),
    )
  }

  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  trace.replaceChildren()
  headline.replaceChildren(
    el(
      'p',
      { class: 'mx-small mx-muted al-empty' },
      'The loop is running. The result shows when it ends.',
    ),
  )

  document.getElementById('trace-box').hidden = false
  runButton.disabled = true
  stopButton.hidden = false
  stopRequested = false

  const steps = []
  // Items that the steps add to the conversation: the model's calls and the tool results.
  const items = []
  let end = null
  let stopText = null

  try {
    for (let number = 1; number <= maxSteps; number++) {
      if (stopRequested) {
        end = 'stopped'
        break
      }

      const pending = pendingView(number)
      trace.append(pending)

      let result
      try {
        result = await call('step', {
          task,
          items,
          number,
          maxSteps,
          ...picker.value(),
        })
      } catch (error) {
        pending.remove()
        showError(notice, error)
        end = 'error'
        break
      }

      steps.push(result.step)
      items.push(...result.added)
      pending.replaceWith(stepView(result.step, result.end))

      if (result.end) {
        end = result.end
        stopText = result.stopText
        break
      }
    }
  } finally {
    renderHeadline(steps, end ?? 'error', stopText)
    runButton.disabled = false
    stopButton.hidden = true
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const setup = await call('setup')
maxAllowed = setup.maxSteps
stepsBox.max = String(maxAllowed)
taskBox.value = setup.task
document.getElementById('tool-names').textContent =
  `${plural(setup.tools.length, 'tool')}: ${setup.tools.map((t) => t.name).join(', ')}`
document
  .getElementById('tool-defs')
  .replaceChildren(codeBlock(prettyJson(setup.tools), 'json'))

document.getElementById('presets').append(
  ...PRESETS.map(([label, text]) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        title: text,
        onclick: () => {
          taskBox.value = text
          taskBox.focus()
        },
      },
      label,
    ),
  ),
)

runButton.addEventListener('click', run)
stopButton.addEventListener('click', () => {
  stopRequested = true
  stopButton.hidden = true
})
taskBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (!runButton.disabled) {
      run()
    }
  }
})
