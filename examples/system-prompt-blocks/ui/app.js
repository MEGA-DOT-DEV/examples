import {
  call,
  codeBlock,
  el,
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
const rows = document.getElementById('rows')
const results = document.getElementById('results')
const verdict = document.getElementById('verdict')
document.getElementById('task').textContent = setup.task
document
  .getElementById('blocks')
  .replaceChildren(
    ...setup.modes.map((mode) =>
      el('li', {}, el('b', {}, mode.label), el('span', {}, mode.block)),
    ),
  )
document.getElementById('tool-names').textContent =
  `${setup.tools.length} tools: ${setup.tools.map((tool) => tool.name).join(', ')}`
document
  .getElementById('tool-defs')
  .replaceChildren(codeBlock(prettyJson(setup.tools), 'json'))
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const count = (n) => el('td', { class: `num${n ? ' mx-bad' : ''}` }, String(n))

function row(mode, score) {
  return el(
    'tr',
    {},
    el('td', {}, mode.label),
    el(
      'td',
      { class: score.finished ? 'mx-good' : 'mx-bad' },
      score.finished ? 'Yes' : 'No',
    ),
    count(score.unansweredQuestions),
    count(score.falseCapabilityClaims),
    count(score.forbiddenCalls),
    el('td', { class: 'num' }, String(score.steps)),
  )
}

// The prompts whose run has a non-zero (or true) score field.
const prompts = (done, field) =>
  done.filter((item) => item.result.score[field]).map((item) => item.mode.label)

function verdictText(done) {
  const correct = prompts(done, 'finished')
  const asked = prompts(done, 'unansweredQuestions')
  const notified = prompts(done, 'forbiddenCalls')

  return [
    correct.length === done.length
      ? `All ${done.length} prompts led to a correct report. Compare the steps and the tool calls.`
      : correct.length
        ? `${correct.length} of ${done.length} prompts led to a correct report. First correct: ${correct[0]}.`
        : 'No prompt led to a correct report.',
    asked.length
      ? `With ${asked.join(', ')}, the agent asked the absent user a question.`
      : null,
    notified.length
      ? `With ${notified.join(', ')}, the agent called the notification tool.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function stepView(step) {
  return el(
    'div',
    { class: 'sp-step' },
    el('b', {}, `Step ${step.number}`),
    ...step.calls.map((tool) =>
      el(
        'p',
        {},
        el('code', {}, tool.name),
        ` ${tool.arguments} → ${tool.output}`,
      ),
    ),
    step.text ? modelText(step.text) : null,
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
  )
}

function resultView(result, mode, number) {
  const end =
    result.end === 'answer'
      ? 'Ended with an answer'
      : `Stopped at the step limit (${setup.maxSteps} steps)`

  return el(
    'article',
    { class: 'sp-result' },
    el(
      'div',
      { class: 'mx-spread' },
      el('h3', { class: 'mx-h3' }, `${number}. ${mode.label}`),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${end} · ${usageText(result.usage)}`,
      ),
    ),
    el(
      'div',
      { class: 'sp-answer' },
      el('span', { class: 'mx-label' }, 'Agent answer'),
      modelText(result.text || '(no answer)'),
    ),
    el(
      'div',
      { class: 'sp-answer' },
      el('span', { class: 'mx-label' }, 'Written report'),
      result.report
        ? modelText(result.report)
        : el('p', { class: 'mx-muted' }, 'No report written.'),
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
          `Tool calls and requests · ${result.steps.length} step${result.steps.length === 1 ? '' : 's'}`,
        ),
      ),
      ...result.steps.map(stepView),
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  showError(notice, null)
  document.getElementById('empty').hidden = true
  document.getElementById('table-box').hidden = true
  verdict.hidden = true
  rows.replaceChildren()
  results.replaceChildren()

  const done = []
  try {
    for (const [index, mode] of setup.modes.entries()) {
      const pending = el(
        'p',
        { class: 'mx-muted', role: 'status' },
        `Running prompt ${index + 1} of ${setup.modes.length}: ${mode.label}…`,
      )
      results.append(pending)

      const result = await call('run', { mode: mode.id, ...picker.value() })
      done.push({ mode, result })
      document.getElementById('table-box').hidden = false
      rows.append(row(mode, result.score))
      pending.replaceWith(resultView(result, mode, index + 1))
    }
  } catch (error) {
    results.querySelector('[role="status"]')?.remove()
    showError(notice, error)
  } finally {
    if (done.length) {
      verdict.textContent = verdictText(done)
      verdict.hidden = false
    }
    button.disabled = false
  }
})
