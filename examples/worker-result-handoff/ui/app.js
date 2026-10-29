import {
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const result = document.getElementById('result')
const evidence = document.getElementById('evidence')
const empty = document.getElementById('empty')
const button = document.getElementById('run')
const linesBox = document.getElementById('lines')
const fieldLabels = {
  result: 'Result',
  filesChanged: 'Files changed',
  openQuestion: 'Open question',
  testsPassed: 'Tests passed',
}
const modeLabel = (mode, lines) =>
  ({
    full: 'Full screen',
    screen: `Last ${lines} lines`,
    report: 'Worker report',
  })[mode]
const cost = (u) =>
  u.cost == null
    ? '—'
    : `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`

function renderScreens(screens) {
  const sizes = [...new Set(screens.map((screen) => screen.lines))]
  document.getElementById('screens-note').textContent =
    `${screens.length} screens · ${sizes.join(' to ')} lines each`
  document.getElementById('lines-hint').textContent =
    `Each screen has ${sizes.join(' to ')} lines.`

  document
    .getElementById('screens')
    .replaceChildren(
      ...screens.map((screen) =>
        el(
          'div',
          { class: 'mx-stack' },
          el('span', { class: 'mx-label' }, screen.id),
          el('p', { class: 'mx-small wh-task' }, screen.task),
          codeBlock(screen.transcript),
        ),
      ),
    )
}

function answerCard(job) {
  const stated = job.stated
  const value = (field) => {
    if (!stated) {
      return 'no valid answer'
    }
    if (field === 'filesChanged') {
      return stated.filesChanged.join(', ') || 'unknown'
    }
    if (field === 'testsPassed') {
      return stated.testsPassed === -1 ? 'unknown' : String(stated.testsPassed)
    }
    return stated[field] || 'unknown'
  }

  return el(
    'article',
    { class: 'wh-answer' },
    el(
      'div',
      { class: 'wh-answer-head' },
      el('code', {}, job.id),
      el('span', { class: 'wh-score' }, `${job.correct} of 4`),
    ),
    ...Object.entries(fieldLabels).map(([field, label]) =>
      el(
        'div',
        { class: 'wh-fact' },
        el(
          'span',
          { class: job.fields[field] ? 'wh-mark mx-good' : 'wh-mark mx-bad' },
          job.fields[field] ? '✓' : '✗',
        ),
        el('span', { class: 'mx-muted' }, `${label}: `),
        el('span', {}, value(field)),
      ),
    ),
  )
}

function modeCard(run, lines) {
  return el(
    'article',
    { class: 'mx-plate wh-mode' },
    el('b', {}, modeLabel(run.mode, lines)),
    ...(run.errors.length
      ? [
          el(
            'p',
            { class: 'mx-small mx-bad' },
            `The answer is not valid: ${run.errors.join('; ')}`,
          ),
        ]
      : []),
    el('div', { class: 'wh-answers' }, ...run.jobs.map(answerCard)),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Request and response'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          `Coordinator · ${run.inputTokens.toLocaleString('en-US')} input tokens`,
        ),
      ),
      requestResponse(run.result.request, run.result.response),
    ),
  )
}

function workerCard(worker) {
  return el(
    'article',
    { class: 'mx-plate wh-report' },
    el('code', {}, worker.id),
    worker.facts
      ? codeBlock(JSON.stringify(worker.facts, null, 2), 'json')
      : el('p', { class: 'mx-small mx-bad' }, worker.error ?? 'No report.'),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Request and response'),
        el('span', { class: 'mx-small mx-muted' }, `Worker · ${worker.id}`),
      ),
      requestResponse(worker.call.request, worker.call.response),
    ),
  )
}

function render(comparison) {
  const lines = comparison.lines

  result.replaceChildren(
    el(
      'p',
      { class: 'mx-lead' },
      el('strong', {}, comparison.headline.finding),
      comparison.headline.detail ? ` ${comparison.headline.detail}` : null,
    ),
    el(
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
            el('th', {}, 'Mode'),
            el('th', { class: 'num' }, 'Facts right'),
            el('th', { class: 'num' }, 'Coordinator input tokens'),
            el('th', {}, 'Coordinator cost'),
          ),
        ),
        el(
          'tbody',
          {},
          comparison.modes.map((run) =>
            el(
              'tr',
              {},
              el('td', {}, el('b', {}, modeLabel(run.mode, lines))),
              el(
                'td',
                { class: `num ${run.correct === 24 ? 'mx-good' : 'mx-bad'}` },
                `${run.correct} of 24`,
              ),
              el(
                'td',
                { class: 'num' },
                run.inputTokens.toLocaleString('en-US'),
              ),
              el('td', {}, cost(run.usage)),
            ),
          ),
        ),
      ),
    ),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `The Worker reports cost ${cost(comparison.workerUsage)} more, once, for the Worker report mode. A missing fact scores 0.`,
    ),
  )

  evidence.hidden = false
  evidence.replaceChildren(
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, 'What the Coordinator wrote'),
      el(
        'p',
        {},
        'Code checks four facts for each job. A short screen does not tell the Coordinator that its top is missing.',
      ),
    ),
    el(
      'div',
      { class: 'wh-modes' },
      ...comparison.modes.map((run) => modeCard(run, lines)),
    ),
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, 'What the Workers filed'),
      el(
        'p',
        {},
        'Each Worker calls the report tool once. The Coordinator reads only these reports in the Worker report mode.',
      ),
    ),
    el('div', { class: 'wh-reports' }, ...comparison.workers.map(workerCard)),
  )
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

try {
  renderScreens(await call('transcripts'))
} catch (error) {
  showError(notice, error)
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  button.disabled = true
  showError(notice, null)

  result.replaceChildren(
    el(
      'p',
      { class: 'mx-muted' },
      'The six Workers file reports. Then the Coordinator reads each handoff…',
    ),
  )
  evidence.hidden = true

  try {
    render(
      await call('run', {
        lines: Number(linesBox.value),
        modes: ['full', 'screen', 'report'],
        ...picker.value(),
      }),
    )
  } catch (error) {
    showError(notice, error)
    result.replaceChildren(empty)
  } finally {
    button.disabled = false
  }
})
