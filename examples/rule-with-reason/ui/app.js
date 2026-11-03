import {
  busy,
  call,
  el,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const picker = await providerPicker(document.getElementById('provider'))
const button = document.getElementById('run')
const runs = document.getElementById('runs')
const notice = document.getElementById('notice')
const result = document.getElementById('result')
const grid = document.getElementById('grid')
const empty = document.getElementById('empty')
const { rule, reason, question, record } = await call('setup')

const pair = (term, ...value) => [
  el('dt', { class: 'mx-label' }, term),
  el('dd', {}, ...value),
]
document
  .getElementById('setup')
  .replaceChildren(
    ...pair('Rule · both agents', rule),
    ...pair('Reason · second agent only', reason),
    ...pair('Customer asks', question),
  )
document
  .getElementById('record')
  .replaceChildren(...record.flatMap(([field, value]) => pair(field, value)))
document.getElementById('record-size').textContent = `${record.length} fields`

runs.addEventListener('change', () => {
  empty.textContent = `Press Run. ${2 * Number(runs.value)} paid requests, under 1 cent.`
})

const DETAILS = [
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Address'],
]
const leaked = (reply) => reply.shown.phone || reply.shown.address

function replyView(reply, index, total) {
  const label =
    total > 1 ? el('p', { class: 'mx-label' }, `Run ${index + 1}`) : null
  if ('error' in reply) {
    return el(
      'div',
      { class: 'reply-run' },
      label,
      el('p', { class: 'mx-callout mx-callout--warn' }, reply.error),
    )
  }

  return el(
    'div',
    { class: 'reply-run' },
    label,
    el(
      'p',
      { class: 'reply-marks' },
      ...DETAILS.flatMap(([key, name], i) => [
        i ? ' · ' : null,
        el(
          'span',
          { class: reply.shown[key] ? 'mx-bad' : 'mx-good' },
          `${name} ${reply.shown[key] ? 'written out' : 'held back'}`,
        ),
      ]),
    ),
    modelText(
      reply.text || '(No reply text returned.)',
      'mx-output reply-text',
    ),
    reply.status !== 'completed'
      ? el(
          'p',
          { class: 'mx-callout mx-callout--warn' },
          `Response ${reply.status}${reply.incompleteReason ? `: ${reply.incompleteReason}` : ''}.`,
        )
      : null,
    el('p', { class: 'mx-small mx-muted' }, usageText(reply.usage)),
    requestResponse(reply.request, reply.response),
  )
}

function columnView(column) {
  const replies = column.replies.filter((reply) => !('error' in reply))
  const count = replies.filter(leaked).length

  return el(
    'article',
    { class: 'mx-plate reply-cell' },
    el(
      'h4',
      { class: 'mx-h3' },
      column.mode === 'rule' ? 'Rule only' : 'Rule + reason',
    ),
    el(
      'p',
      { class: `reply-count ${count ? 'mx-bad' : 'mx-good'}` },
      `Phone or address in public: ${count} of ${replies.length}`,
    ),
    ...column.replies.map((reply, index) =>
      replyView(reply, index, column.replies.length),
    ),
  )
}

function meaning(columns) {
  const [ruleOnly, withReason] = columns.map((column) =>
    column.replies.filter((reply) => !('error' in reply)),
  )
  const emailHidden = [...ruleOnly, ...withReason].every(
    (reply) => !reply.shown.email,
  )
  if (
    emailHidden &&
    ruleOnly.length &&
    ruleOnly.every(leaked) &&
    withReason.length &&
    !withReason.some(leaked)
  ) {
    return 'Both agents kept the email out, as the rule says. Only the agent that knew why also kept the phone and the address out of the public forum.'
  }

  return 'This run does not show a clear difference. The replies below are the real result.'
}

button.addEventListener('click', () =>
  busy(button, 'Running…', async () => {
    showError(notice, null)
    result.hidden = true
    empty.hidden = false
    empty.textContent = `Sending ${2 * Number(runs.value)} paid requests…`

    try {
      const columns = await call('run', {
        runs: Number(runs.value),
        ...picker.value(),
      })
      grid.replaceChildren(...columns.map(columnView))
      document.getElementById('meaning').textContent = meaning(columns)
      empty.hidden = true
      result.hidden = false
    } catch (error) {
      showError(notice, error)
      empty.textContent =
        'The comparison did not complete. Check the error above and try again.'
    }
  }),
)
