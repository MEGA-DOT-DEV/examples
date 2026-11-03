import {
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

const notice = document.getElementById('notice')
const result = document.getElementById('result')
const button = document.getElementById('run')
const handoff = document.getElementById('handoff')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

function traceDetails(trace, index) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Request and response · ${trace.actor} ${index + 1}`,
      ),
    ),
    requestResponse(trace.result.request, trace.result.response),
    trace.tool ? codeBlock(JSON.stringify(trace.tool, null, 2), 'json') : null,
  )
}

function runCard(run) {
  return el(
    'article',
    { class: 'mx-plate ab-card mx-stack' },
    cardTitle(run),
    el('p', { class: 'mx-small mx-muted' }, run.score.reason),
    facts(run),
    exchange(run),
    bookingLine(run),
    el(
      'div',
      { class: 'mx-stack' },
      el('span', { class: 'mx-label' }, 'Subagent reply'),
      run.finalText
        ? modelText(run.finalText)
        : el('p', { class: 'mx-muted' }, 'The model returned no final text.'),
    ),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${run.traces.length} model requests · ${usageText(run.usage)}`,
    ),
    tracesFold(run),
  )
}

function cardTitle(run) {
  return el(
    'div',
    { class: 'ab-title' },
    el(
      'h3',
      { class: 'mx-h3' },
      run.mode === 'one-shot' ? 'One shot' : 'Ask and resume',
    ),
    el(
      'span',
      { class: run.score.correct ? 'mx-good' : 'mx-bad' },
      run.score.correct ? 'Correct' : 'Not correct',
    ),
  )
}

function facts(run) {
  return el(
    'dl',
    { class: 'ab-facts' },
    el(
      'div',
      {},
      el('dt', { class: 'mx-label' }, 'Task status'),
      el('dd', {}, run.statusHistory.join(' → ')),
    ),
    el(
      'div',
      {},
      el('dt', { class: 'mx-label' }, 'Final booking date'),
      el('dd', {}, run.finalDate ?? 'Unchanged'),
    ),
  )
}

/** The question and the parent's answer, when the subagent asked. */
function exchange(run) {
  if (!run.question) {
    return null
  }

  return el(
    'div',
    { class: 'ab-exchange mx-stack' },
    el('p', {}, el('strong', {}, 'Subagent → parent: '), run.question),
    el(
      'p',
      {},
      el('strong', {}, 'Parent → subagent: '),
      run.answer || '(no answer)',
    ),
  )
}

function bookingLine(run) {
  if (!run.bookingAttempt) {
    return null
  }

  return el(
    'p',
    { class: 'mx-small' },
    el('strong', {}, 'Booking tool: '),
    run.bookingAttempt.outcome,
  )
}

function tracesFold(run) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Real requests and responses · ${run.traces.length}`,
      ),
    ),
    el('div', { class: 'mx-stack ab-traces' }, ...run.traces.map(traceDetails)),
  )
}

function render(comparison) {
  result.replaceChildren(
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, 'The handoff'),
      el(
        'p',
        {},
        'The subagent reads this brief, not the parent’s client conversation.',
      ),
    ),
    el('p', { class: 'mx-plate ab-brief' }, comparison.brief),
    el(
      'div',
      { class: 'mx-section-head' },
      el('h3', { class: 'mx-h3' }, 'What happened'),
      el(
        'p',
        {},
        'The booking changes only when the tool receives a date confirmed by the handoff or the parent. A report alone does not count.',
      ),
    ),
    el('div', { class: 'ab-grid' }, ...comparison.runs.map(runCard)),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `Total model usage: ${usageText(comparison.usage)}. The booking is fake and resets on each run.`,
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
          `Parent’s held client conversation · ${comparison.parentThread.length} messages`,
        ),
      ),
      codeBlock(comparison.parentThread.join('\n')),
    ),
  )
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
      'Running both subagents with the selected handoff…',
    ),
  )

  try {
    render(await call('run', { handoff: handoff.value, ...picker.value() }))
  } catch (error) {
    showError(notice, error)
    result.replaceChildren(
      el(
        'p',
        { class: 'mx-muted' },
        'The comparison did not finish. Change the settings and run it again.',
      ),
    )
  } finally {
    button.disabled = false
  }
})
