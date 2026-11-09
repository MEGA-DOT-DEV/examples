import {
  busy,
  call,
  codeBlock,
  el,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const picker = await providerPicker(document.getElementById('picker'))
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const results = document.getElementById('results')
const meaning = document.getElementById('meaning')
const LABELS = {
  code: 'Code only',
  decision: 'Code + decision record',
  test: 'Code + intent test',
}

function details(title, child) {
  return el('details', { class: 'mx-details' }, el('summary', {}, title), child)
}

function card(mode, trials) {
  const passed = trials.filter((trial) => trial.score.pass).length

  return el(
    'article',
    { class: 'mx-plate dg-card' },
    el('h3', { class: 'mx-h3' }, LABELS[mode]),
    el(
      'strong',
      {
        class: `dg-score ${passed === trials.length ? 'mx-good' : 'mx-bad'}`,
      },
      `Passed ${passed} of ${trials.length}`,
    ),
    ...trials.map(runView),
  )
}

function runView(trial, index) {
  const { score, diff, usage, steps } = trial
  const diffLines = diff.split('\n').length
  let carrier = 'No ADR in this mode'
  if (trial.mode === 'decision') {
    carrier = trial.filesRead.includes('decisions/0001-line-tax-rounding.md')
      ? 'Read the ADR'
      : 'Did not read the ADR'
  }

  return el(
    'section',
    { class: 'mx-stack dg-run' },
    el('h4', { class: 'mx-h3' }, `Run ${index + 1}`),
    el(
      'div',
      { class: 'dg-metrics' },
      el('span', {}, `Lawful invoices kept · ${score.correct}/5`),
      el('span', {}, `Exports match invoices · ${score.matched}/5`),
      el('span', {}, carrier),
      el(
        'span',
        {},
        trial.testsRun ? 'Ran the tests' : 'Did not run the tests',
      ),
      el(
        'span',
        {},
        trial.testsEdited ? 'Edited a test file' : 'Did not edit tests',
      ),
    ),
    el('p', { class: 'mx-small mx-muted' }, usageText(usage)),
    modelText(trial.answer || 'No final answer.'),
    ...(score.error ? [el('p', { class: 'mx-bad' }, score.error)] : []),
    details(`Diff · ${diffLines} lines`, codeBlock(diff, 'diff')),
    details(
      `Steps · ${steps.length}`,
      el(
        'div',
        {},
        el('p', {}, `Files read: ${trial.filesRead.join(', ') || 'none'}`),
        ...steps.map(stepView),
      ),
    ),
  )
}

function stepView(step, index) {
  return el(
    'div',
    { class: 'dg-step' },
    el('p', {}, `Step ${index + 1}: ${step.calls.length} tool calls`),
    ...step.calls.map((line) => codeBlock(line, 'text')),
    ...(step.calls.length && step.text ? [modelText(step.text)] : []),
    details(
      `Request and response · step ${index + 1}`,
      requestResponse(step.request, step.response),
    ),
  )
}

button.addEventListener('click', () =>
  busy(button, 'Running nine trials…', async () => {
    showError(notice, null)
    results.replaceChildren()
    meaning.textContent = 'Up to three agents are working on separate copies.'

    try {
      const trials = await call('run', picker.value())
      results.replaceChildren(
        ...Object.keys(LABELS).map((mode) =>
          card(
            mode,
            trials.filter((trial) => trial.mode === mode),
          ),
        ),
      )
      meaning.textContent =
        'A run passes only when all five invoice totals keep the law and the accounting export matches them; fixing the mismatch on the wrong side fails.'
    } catch (error) {
      showError(notice, error)
      meaning.textContent =
        'The run did not finish. Check the error and try again.'
    }
  }),
)
