import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const result = document.getElementById('result')
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const views = setup.modes
document.getElementById('intro').textContent =
  `One run asks ${setup.questions} questions about ${setup.files} files in each of ${views.length} views. Only the tool result changes.`
button.textContent = `Compare ${views.length} views`
const empty = el(
  'p',
  { class: 'mx-muted' },
  `Press ${button.textContent}. At least ${setup.minRequests} paid requests; each re-read adds one.`,
)
result.replaceChildren(empty)

const VERDICTS = {
  correct: 'correct',
  'cannot-see': 'cannot see',
  confabulated: 'wrong',
}
const TONES = {
  correct: 'mx-good',
  'cannot-see': 'mx-muted',
  confabulated: 'mx-bad',
}
const runs = new Map()
const count = (run, verdict) =>
  run.answers.filter((answer) => answer.verdict === verdict).length
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const summary = (title, detail) =>
  el(
    'summary',
    {},
    el('span', { class: 'mx-label' }, title),
    el('span', { class: 'mx-small mx-muted' }, detail),
  )

function addUsage(a, b) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cost: a.cost === null || b.cost === null ? null : a.cost + b.cost,
    costSource:
      a.costSource === 'estimate' || b.costSource === 'estimate'
        ? 'estimate'
        : (b.costSource ?? a.costSource),
  }
}

// The finding, from this run: what a cut or cleared tool result cost, with and without a note.
function headline() {
  const correct = (id) => count(runs.get(id), 'correct')
  const rereads = (...ids) =>
    ids.reduce((sum, id) => sum + runs.get(id).rereads.length, 0)
  const times = (n) => `${n} ${n === 1 ? 'time' : 'times'}`

  const full = correct('full')
  const wrong = views.reduce(
    (sum, view) => sum + count(runs.get(view.id), 'confabulated'),
    0,
  )
  const lost =
    correct('silent-cut') < full || correct('silent-clear') < full || wrong > 0

  return el(
    'div',
    { class: `mx-callout${lost ? ' mx-callout--warn' : ''}` },
    el(
      'p',
      {},
      `Full files: ${full} of ${setup.questions} correct. Cut report: ${correct('silent-cut')} with no note and ${correct('marked-cut')} with a note; cleared result: ${correct('silent-clear')} with no note and ${correct('marked-clear')} with a note. ` +
        `The model re-read files ${times(rereads('silent-cut', 'silent-clear'))} with no note and ${times(rereads('marked-cut', 'marked-clear'))} with a note, and gave ${plural(wrong, 'wrong answer')}.`,
    ),
  )
}

function summaryTable(done) {
  return el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table loss-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ...[
            'View',
            'Correct',
            'Cannot see',
            'Wrong',
            'Re-reads',
            'Requests',
          ].map((name) => el('th', {}, name)),
        ),
      ),
      el(
        'tbody',
        {},
        ...done.map((view) => {
          const run = runs.get(view.id)

          return el(
            'tr',
            {},
            el(
              'td',
              {},
              el('strong', {}, view.label),
              el('div', { class: 'mx-hint' }, view.view),
            ),
            el('td', {}, String(count(run, 'correct'))),
            el('td', {}, String(count(run, 'cannot-see'))),
            el(
              'td',
              { class: count(run, 'confabulated') ? 'mx-bad' : '' },
              String(count(run, 'confabulated')),
            ),
            el('td', {}, String(run.rereads.length)),
            el(
              'td',
              {},
              `${run.steps.length}${run.end === 'step_limit' ? ' (limit)' : ''}`,
            ),
          )
        }),
      ),
    ),
  )
}

// Every answer stays open, one column per view, so views compare without clicks.
function answersTable(done) {
  const first = runs.get(done[0].id)

  return el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table loss-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Question'),
          el('th', {}, 'Value in the files'),
          ...done.map((view) => el('th', {}, view.label)),
        ),
      ),
      el(
        'tbody',
        {},
        ...first.answers.map((row, index) =>
          el(
            'tr',
            {},
            el('td', {}, row.question),
            el('td', { class: 'loss-value' }, row.expected),
            ...done.map((view) => {
              const answer = runs.get(view.id).answers[index]

              return el(
                'td',
                {
                  class: `loss-value ${TONES[answer.verdict]}`,
                  title: VERDICTS[answer.verdict],
                },
                answer.answer || '(no answer)',
              )
            }),
          ),
        ),
      ),
    ),
  )
}

function stepsFold(view) {
  const run = runs.get(view.id)

  return el(
    'details',
    { class: 'mx-details' },
    summary(
      view.label,
      `${plural(run.steps.length, 'request')}, ${plural(run.rereads.length, 're-read')}`,
    ),
    el(
      'div',
      { class: 'loss-steps' },
      ...run.steps.map((step, index) =>
        el(
          'div',
          { class: 'loss-step' },
          el('strong', {}, `${index + 1}. ${step.phase}`),
          ...step.calls.map((c) =>
            el(
              'details',
              { class: 'mx-details' },
              summary(
                'Tool result',
                `${c.path} · ${plural(c.output.split('\n').length, 'line')}`,
              ),
              codeBlock(c.output),
            ),
          ),
          requestResponse(step.request, step.response),
        ),
      ),
      el(
        'details',
        { class: 'mx-details' },
        summary('Final reply', plural(run.text.length, 'character')),
        modelText(run.text || '(no answer)'),
      ),
    ),
  )
}

function render(progress) {
  const done = views.filter((view) => runs.has(view.id))
  if (!done.length && !progress) {
    return result.replaceChildren(empty)
  }

  const total = done.reduce(
    (sum, view) => addUsage(sum, runs.get(view.id).usage),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      costSource: null,
    },
  )

  result.replaceChildren(
    ...[
      progress
        ? el('p', { class: 'mx-muted' }, progress)
        : done.length === views.length
          ? headline()
          : null,
      done.length ? summaryTable(done) : null,
      done.length ? answersTable(done) : null,
      done.length
        ? el(
            'p',
            { class: 'mx-small mx-muted' },
            `Green is the exact value from the files, gray is "cannot see", and red is any other value. ${runs.get(done[0].id).model} · total ${usageText(total)}`,
          )
        : null,
      ...done.map(stepsFold),
    ].filter(Boolean),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  runs.clear()

  await busy(button, 'Running…', async () => {
    try {
      for (const [index, view] of views.entries()) {
        render(`Running view ${index + 1} of ${views.length}: ${view.label}…`)
        runs.set(
          view.id,
          await call('run', { mode: view.id, ...picker.value() }),
        )
      }
      render()
    } catch (error) {
      showError(notice, error)
      render()
    }
  })
})
