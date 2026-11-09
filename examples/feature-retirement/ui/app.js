import {
  call,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const result = document.getElementById('result')
const button = document.getElementById('run')
const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const money = (amount) => `$${amount.toLocaleString()}`
const label = (mode) =>
  mode === 'usage' ? 'Usage only' : 'With business context'

function modeCard(group) {
  const risks = group.runs.map((run) => run.revenueAtRisk)
  const minimum = Math.min(...risks)
  const maximum = Math.max(...risks)
  const amount =
    minimum === maximum ? money(maximum) : `${money(minimum)}–${money(maximum)}`
  const riskRuns = risks.filter((risk) => risk > 0).length
  const count = group.runs.length
  const headline = `${amount} at risk in ${riskRuns} of ${count} runs`
  const average = group.runs.reduce((sum, run) => sum + run.correct, 0) / count

  return el(
    'article',
    { class: 'mx-plate fr-card' },
    el('h2', { class: 'mx-h3' }, label(group.mode)),
    el('b', { class: 'fr-number' }, headline),
    el(
      'p',
      { class: 'mx-muted' },
      `${average.toFixed(1)} of 10 decisions right on average.`,
    ),
  )
}

function decisionMarks(feature, group) {
  return el(
    'td',
    {},
    el(
      'div',
      { class: 'fr-marks' },
      ...group.runs.map((run, index) => {
        const choice = run.choices.find((item) => item.id === feature.id)
        const right = choice.decision === feature.key
        const mark = right ? '✓' : '✗'

        return el(
          'span',
          {
            class: right ? 'mx-good' : 'mx-bad',
            'aria-label': `Run ${index + 1}: ${choice.decision}, ${right ? 'right' : 'wrong'}`,
          },
          `${choice.decision} ${mark}`,
        )
      }),
    ),
  )
}

function featureTable(modes) {
  const headings = [
    'Feature',
    'Key',
    ...modes.map((group) => label(group.mode)),
  ]

  return el(
    'div',
    { class: 'fr-scroll' },
    el(
      'table',
      { class: 'mx-table' },
      el(
        'thead',
        {},
        el('tr', {}, ...headings.map((heading) => el('th', {}, heading))),
      ),
      el(
        'tbody',
        {},
        ...setup.features.map((feature) =>
          el(
            'tr',
            {},
            el('th', { scope: 'row' }, feature.name),
            el('td', {}, feature.key),
            ...modes.map((group) => decisionMarks(feature, group)),
          ),
        ),
      ),
    ),
  )
}

function evidence(comparison) {
  const reasons = comparison.modes.flatMap((group) =>
    group.runs.flatMap((run, index) =>
      run.choices.map((choice) => {
        const feature = setup.features.find((item) => item.id === choice.id)
        const title = `${label(group.mode)} · Run ${index + 1} · ${feature.name}`

        return el(
          'div',
          {},
          el('h3', { class: 'mx-h3' }, title),
          modelText(choice.reason),
        )
      }),
    ),
  )
  const requests = comparison.modes.flatMap((group) =>
    group.runs.map((run, index) =>
      el(
        'div',
        {},
        el('h3', { class: 'mx-h3' }, `${label(group.mode)} · Run ${index + 1}`),
        requestResponse(run.request, run.response),
      ),
    ),
  )

  return el(
    'div',
    {},
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, `Reasons · ${reasons.length}`),
      ...reasons,
    ),
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, `Requests and responses · ${requests.length} runs`),
      ...requests,
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  button.disabled = true
  button.textContent = 'Running…'
  result.replaceChildren(
    el('p', { class: 'mx-muted' }, 'Comparing both modes…'),
  )

  try {
    const comparison = await call('run', {
      runs: document.getElementById('runs').value,
      ...picker.value(),
    })
    result.replaceChildren(
      el('div', { class: 'fr-grid' }, ...comparison.modes.map(modeCard)),
      featureTable(comparison.modes),
      el(
        'p',
        { class: 'mx-muted' },
        'Yearly revenue counts each affected account once. Marks follow run order; a cross means the choice differs from the key.',
      ),
      evidence(comparison),
      el(
        'p',
        { class: 'mx-muted' },
        `${comparison.requests} requests · ${usageText(comparison.usage)}`,
      ),
    )
  } catch (error) {
    showError(notice, error)
    result.replaceChildren()
  } finally {
    button.disabled = false
    button.textContent = 'Run both modes'
  }
})
