import {
  busy,
  call,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const picker = await providerPicker(document.getElementById('picker'))
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const faultBox = document.getElementById('fault')
const setup = await call('setup')
if (!picker.hasKey()) {
  missingKeyNote(notice)
}
faultBox.replaceChildren(
  ...setup.faults.map((fault) =>
    el('option', { value: fault.id }, fault.label),
  ),
)

const labelOf = Object.fromEntries(
  setup.modes.map((mode) => [mode.id, mode.label]),
)
const HOW = {
  unhandled: 'The loop stops at the first fault.',
  retry:
    'Waits, then sends the same request again. A new session starts after step 1 and has no saved conversation.',
  resume:
    'Retries the same way. The new session loads the conversation saved after step 1.',
}
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/** One sentence per mode, from what the run did: stopped, ran step 1 again, or kept it. */
function verdict(run) {
  const label = labelOf[run.mode]

  if (!run.finished) {
    const fault = run.events.findLast((event) => event.kind === 'fault')
    return fault
      ? `${label} stopped at step ${fault.step}: ${fault.detail}.`
      : `${label} stopped without a final answer.`
  }

  const step1Requests = run.events.filter(
    (event) => event.kind === 'model' && event.step === 1,
  ).length
  if (step1Requests > 1) {
    return `${label} finished, but ran step 1 again after the new session.`
  }
  if (run.events.some((event) => event.kind === 'restart')) {
    return `${label} finished and kept step 1 through the new session.`
  }

  return `${label} finished.`
}

function row(run) {
  return el(
    'tr',
    {},
    el('td', {}, labelOf[run.mode]),
    el('td', { class: 'num' }, String(run.calls)),
    el('td', { class: 'num' }, String(run.repeatedSteps)),
    el('td', { class: 'num' }, run.resentTokens.toLocaleString('en-US')),
    el('td', { class: 'num' }, formatCost(run.usage.cost)),
    el('td', { class: 'num' }, seconds(run.elapsedMs)),
  )
}

function eventView(event) {
  const where =
    event.attempt > 1
      ? `Step ${event.step}, attempt ${event.attempt}`
      : `Step ${event.step}`
  const detail =
    event.kind === 'tool' ? el('code', {}, event.detail) : event.detail

  return el(
    'li',
    { class: `lr-${event.kind}` },
    el('b', {}, `${where} · ${capital(setup.events[event.kind])}:`),
    ' ',
    detail,
  )
}

function card(run) {
  const requests = run.events.filter((event) => event.request)

  return el(
    'article',
    { class: 'mx-panel lr-card' },
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, labelOf[run.mode]),
      el('p', {}, HOW[run.mode]),
    ),
    el(
      'ol',
      { class: 'lr-events' },
      run.events.filter((event) => event.kind !== 'answer').map(eventView),
    ),
    run.answer
      ? el(
          'div',
          { class: 'mx-stack lr-answer' },
          el('span', { class: 'mx-label' }, 'Final answer'),
          modelText(run.answer, 'mx-output'),
        )
      : el('p', { class: 'mx-small mx-bad' }, 'No final answer.'),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el(
          'span',
          { class: 'mx-label' },
          `Raw requests and responses · ${requests.length}`,
        ),
      ),
      el(
        'div',
        { class: 'mx-stack lr-raw' },
        requests.map((event) =>
          el(
            'div',
            { class: 'mx-stack' },
            el(
              'span',
              { class: 'mx-label' },
              `Step ${event.step}, attempt ${event.attempt}`,
            ),
            requestResponse(event.request, event.response),
          ),
        ),
      ),
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const rows = document.getElementById('rows')
  const cards = document.getElementById('cards')
  const verdictBox = document.getElementById('verdict')

  rows.replaceChildren()
  cards.replaceChildren()
  verdictBox.hidden = true
  document.getElementById('empty').hidden = true
  document.getElementById('totals-box').hidden = false
  document.getElementById('steps-box').hidden = false

  const runs = []
  await busy(button, 'Running…', async () => {
    try {
      for (const mode of setup.modes) {
        button.textContent = `Running ${runs.length + 1} of ${setup.modes.length}…`
        const run = await call('run', {
          mode: mode.id,
          fault: faultBox.value,
          ...picker.value(),
        })
        runs.push(run)
        rows.append(row(run))
        cards.append(card(run))
      }

      document.getElementById('cost-head').textContent = runs.some(
        (run) => run.usage.costSource === 'estimate',
      )
        ? 'Cost (est.)'
        : 'Cost'

      verdictBox.textContent = runs.map(verdict).join(' ')
      verdictBox.hidden = false
    } catch (error) {
      showError(notice, error)
    }
  })
})
