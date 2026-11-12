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
const headline = document.getElementById('headline')
const readouts = document.getElementById('readouts')
const meaning = document.getElementById('meaning')
const table = document.getElementById('table')
const rows = document.getElementById('rows')
const evidence = document.getElementById('evidence')
const traffic = document.getElementById('traffic')

const labels = {
  'matches-and-fits': 'Matches and fits',
  'misses-agreement': 'Misses the agreement',
  'matches-but-doesnt-fit': "Matches but doesn't fit",
  none: 'No verdict',
}

// The mark says whether the judge agreed with the right answer, apart from
// the verdict itself: "Misses the agreement" is bad news even when judged right.
function verdictCell(row) {
  const mark = row.correct ? '✓ Judged right' : '✗ Judged wrong'

  return el(
    'td',
    { class: row.correct ? '' : 'mf-wrong' },
    el('strong', {}, labels[row.verdict]),
    el('div', { class: `mf-mark ${row.correct ? 'mx-good' : 'mx-bad'}` }, mark),
    modelText(row.reason, 'mf-reason'),
  )
}

function readout(label, items) {
  const right = items.filter((item) => item.correct).length

  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, `${right} of ${items.length}`),
    el('span', { class: 'mx-small mx-muted' }, 'judged right'),
  )
}

// The lesson is in the features that meet their bar but clash with the product.
function headlineText(signals, context) {
  const misfits = signals.filter(
    (row) => row.key === 'matches-but-doesnt-fit',
  ).length
  const caught = (items) =>
    items.filter((row) => row.key === 'matches-but-doesnt-fit' && row.correct)
      .length
  const without = `Without product context, the judge caught ${caught(signals)} of ${misfits} features that match but don't fit.`

  return `${without} With it, the judge caught ${caught(context)} of ${misfits}.`
}

function show(result) {
  const signals = result.judgments.filter((row) => row.mode === 'signals')
  const context = result.judgments.filter((row) => row.mode === 'context')
  headline.textContent = headlineText(signals, context)
  readouts.replaceChildren(
    readout('Agreement and signals', signals),
    readout('With product context', context),
  )
  readouts.hidden = false
  meaning.textContent = `Both judges get the same agreement and 30-day signals. Only the second also sees the product vision, the other features and the team plans. ${usageText(result.usage)} total.`
  meaning.hidden = false
  table.hidden = false

  rows.replaceChildren(
    ...signals.map((first, index) => {
      const second = context[index]
      const { feature } = first
      return el(
        'tr',
        {},
        el(
          'th',
          { scope: 'row' },
          el('strong', {}, feature.name),
          el(
            'div',
            { class: 'mf-meta' },
            `${feature.signals.measuredPercent}% measured · ${feature.agreement.barPercent}% bar`,
          ),
        ),
        el('td', {}, labels[first.key]),
        verdictCell(first),
        verdictCell(second),
      )
    }),
  )

  evidence.hidden = false
  traffic.replaceChildren(
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, 'Fixture · six agreements and 30-day signals'),
      codeBlock(
        JSON.stringify(
          signals.map(({ feature }) => ({
            name: feature.name,
            agreement: feature.agreement,
            signals: feature.signals,
          })),
          null,
          2,
        ),
        'json',
      ),
    ),
    ...result.judgments.map((row) =>
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          `Request and response · ${row.feature.name} · ${row.mode}`,
        ),
        requestResponse(row.request, row.response),
      ),
    ),
  )
}

button.addEventListener('click', () =>
  busy(button, 'Judging…', async () => {
    showError(notice, null)
    try {
      show(await call('run', picker.value()))
    } catch (error) {
      showError(notice, error)
    }
  }),
)
