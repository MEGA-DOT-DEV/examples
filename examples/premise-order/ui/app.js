import {
  busy,
  call,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const runsBox = document.getElementById('runs')
const effortBox = document.getElementById('effort')
const headline = document.getElementById('headline')
const raw = document.getElementById('raw')
const variantBox = document.getElementById('variant')
// The classic answer is correct in order, and wrong where a line moved or changed: the result says so.
const VERDICTS = {
  correct: ['Correct', 'mx-good'],
  classic: ['Wrong: the classic answer', 'mx-bad'],
  wrong: ['Wrong', 'mx-bad'],
}

let effort = setup.defaultEffort
let report = null
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('question').textContent = setup.question

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const shownCases = () =>
  setup.cases.filter((c) => !c.variant || variantBox.checked)
// A line moved when another letter holds its place in the in-order riddle.
const inOrderLabels = setup.cases
  .find((c) => c.id === 'in-order')
  .lines.map((line) => line.label)
const lineMark = (line, place) =>
  line.changed
    ? 'changed'
    : line.label !== inOrderLabels[place]
      ? 'moved'
      : null

function renderEffort() {
  effortBox.replaceChildren(
    ...setup.efforts.map((value) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === effort),
          onclick: () => {
            effort = value
            renderEffort()
          },
        },
        value,
      ),
    ),
  )
}

function renderEmpty() {
  if (report) {
    return
  }

  const runs = Number(runsBox.value) || 0
  headline.replaceChildren(
    el(
      'p',
      { class: 'mx-muted' },
      `Press Run. ${plural(shownCases().length * runs, 'request')}, under 1 cent.`,
    ),
  )
}

// Each run: the answer that code read from the reply, and its verdict against this version's correct answer.
const answerText = (row) =>
  `${row.choice ?? '(no choice)'}, ${row.chanceText ?? '(no chance)'}`
const runsTable = (rows) =>
  el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table po-runs' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { class: 'num' }, 'Run'),
          el('th', {}, 'Answer'),
          el('th', {}, 'Result'),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el(
            'tr',
            {},
            el('td', { class: 'num' }, String(row.run)),
            el('td', {}, answerText(row)),
            el(
              'td',
              { class: VERDICTS[row.verdict][1] },
              VERDICTS[row.verdict][0],
            ),
          ),
        ),
      ),
    ),
  )

const repliesFold = (rows) =>
  el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Replies as written'),
      el('span', { class: 'mx-hint' }, plural(rows.length, 'run')),
    ),
    el(
      'div',
      { class: 'mx-stack po-pad' },
      rows.map((row) =>
        el(
          'div',
          { class: 'mx-stack' },
          el('span', { class: 'mx-label' }, `Run ${row.run}`),
          modelText(row.text.trim() || '(no answer)', 'mx-small'),
        ),
      ),
    ),
  )

function renderCases() {
  document.getElementById('cases').replaceChildren(
    ...shownCases().map((item) => {
      const rows = report?.rows.filter((row) => row.caseId === item.id) ?? []

      return el(
        'div',
        { class: 'mx-plate po-case' },
        el('h3', { class: 'mx-h3' }, item.name),
        el(
          'ol',
          { class: 'po-lines' },
          item.lines.map((line, place) => {
            const mark = lineMark(line, place)
            return el(
              'li',
              {},
              el(
                'div',
                { class: 'po-line' },
                el(
                  'span',
                  { class: mark ? 'po-letter po-marked' : 'po-letter' },
                  line.label,
                ),
                el('span', {}, line.text),
                mark ? el('span', { class: 'po-mark' }, mark) : null,
              ),
            )
          }),
        ),
        el(
          'div',
          {},
          el('p', {}, 'Correct answer: ', el('strong', {}, item.key.text)),
          el('p', { class: 'mx-small mx-muted' }, item.why),
        ),
        rows.length ? runsTable(rows) : null,
        rows.length ? repliesFold(rows) : null,
      )
    }),
  )
}

function renderResult() {
  // One readout per version, all in the same measure: correct runs.
  const readout = (item) => {
    const correct = report.totals[item.id].correct
    return el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, `${item.name} · correct`),
      el(
        'b',
        { class: correct === report.runs ? 'mx-good' : 'mx-bad' },
        `${correct} of ${report.runs}`,
      ),
    )
  }

  headline.replaceChildren(
    el(
      'div',
      { class: 'mx-stack' },
      el(
        'div',
        { class: 'mx-readouts' },
        setup.cases.filter((c) => report.totals[c.id]).map(readout),
      ),
      report.summary.meaning
        ? el('p', { class: 'po-meaning' }, report.summary.meaning)
        : null,
    ),
  )

  renderCases()

  const name = (id) => setup.cases.find((c) => c.id === id).name
  raw.replaceChildren(
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Requests and responses'),
        el(
          'span',
          { class: 'mx-hint' },
          `${plural(report.rows.length, 'request')} · ${usageText(report.usage)}`,
        ),
      ),
      el(
        'div',
        { class: 'mx-stack po-pad' },
        report.rows.map((row) =>
          el(
            'div',
            { class: 'mx-stack' },
            el(
              'span',
              { class: 'mx-label' },
              `${name(row.caseId)} · run ${row.run}`,
            ),
            requestResponse(row.request, row.response),
          ),
        ),
      ),
    ),
  )
}

async function run() {
  notice.replaceChildren()
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  try {
    report = await busy(button, 'Running…', () =>
      call('run', {
        runs: Number(runsBox.value),
        effort,
        variant: variantBox.checked,
        ...picker.value(),
      }),
    )
    renderResult()
  } catch (error) {
    showError(notice, error)
  }
}

runsBox.addEventListener('input', renderEmpty)
variantBox.addEventListener('change', () => {
  renderCases()
  renderEmpty()
})
button.addEventListener('click', run)

renderEffort()
renderCases()
renderEmpty()
