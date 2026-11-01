import {
  busy,
  call,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const button = document.getElementById('run')
const picker = await providerPicker(document.getElementById('picker'))
const corpus = await call('setup')
const MODES = ['profile', 'tools', 'entities']

document
  .getElementById('corpus')
  .append(
    ...corpus.sessions.map((session) =>
      el(
        'li',
        { class: 'me-session' },
        el(
          'span',
          { class: 'mx-label' },
          `${session.date} · ${session.checks}`,
        ),
        el('p', { class: 'mx-small mx-muted' }, session.context),
        el('p', {}, `“${session.text}”`),
      ),
    ),
  )

if (!picker.hasKey()) {
  missingKeyNote(notice)
}

function documentView(document) {
  return el(
    'div',
    { class: 'me-document' },
    el('span', { class: 'mx-label' }, document.document),
    document.facts.length
      ? el(
          'ul',
          {},
          ...document.facts.map((fact) =>
            el('li', {}, `${fact.key.replace('_', ' ')}: ${fact.value}`),
          ),
        )
      : el('p', { class: 'mx-muted' }, 'No facts.'),
  )
}

// One plain sentence per mode: what went wrong, or that nothing did. The counts stay in the table.
function verdict(outcome) {
  const s = outcome.score
  const name = outcome.title.split(' · ')[0]
  const errors = [
    s.retained < s.possible
      ? `lost ${s.possible - s.retained === 1 ? 'a fact' : 'facts'}`
      : null,
    s.stale ? 'kept an outdated value' : null,
    s.crossPerson ? 'mixed up the two people' : null,
    s.duplicates ? 'saved duplicates' : null,
  ].filter(Boolean)

  if (!errors.length) {
    return `${name} kept every fact with no errors.`
  }

  return `${name} ${errors.length > 1 ? `${errors.slice(0, -1).join(', ')} and ${errors.at(-1)}` : errors[0]}.`
}

const cell = (value, bad) =>
  el('td', { class: `num${bad ? ' mx-bad' : ''}` }, String(value))

function scoreRow(outcome) {
  const s = outcome.score

  return el(
    'tr',
    {},
    el('td', {}, outcome.title.split(' · ')[0]),
    cell(`${s.retained}/${s.possible}`, s.retained < s.possible),
    cell(s.stale, s.stale > 0),
    cell(s.crossPerson, s.crossPerson > 0),
    cell(s.duplicates, s.duplicates > 0),
    cell(s.pending, false),
    cell(s.requests, false),
    cell(
      s.cost === null
        ? 'n/a'
        : `${formatCost(s.cost)}${s.costEstimated ? ' est.' : ''}`,
      false,
    ),
  )
}

function sessionRow(session) {
  const facts = session.memory.reduce((n, doc) => n + doc.facts.length, 0)

  return el(
    'div',
    { class: 'me-history-row' },
    el('span', { class: 'mx-label' }, `${session.date} · ${session.checks}`),
    session.changes.length
      ? el(
          'ul',
          { class: 'me-changes' },
          ...session.changes.map((change) => el('li', {}, change)),
        )
      : el('p', {}, 'No change.'),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        `Memory after · ${facts} fact${facts === 1 ? '' : 's'}`,
      ),
      el('div', { class: 'me-documents' }, ...session.memory.map(documentView)),
    ),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        session.requests.length === 1
          ? 'Request and response'
          : `Requests and responses · ${session.requests.length}`,
      ),
      ...session.requests.map((exchange) =>
        el(
          'div',
          { class: 'me-exchange' },
          el('p', { class: 'mx-small mx-muted' }, usageText(exchange.usage)),
          requestResponse(exchange.request, exchange.response),
        ),
      ),
    ),
  )
}

function modeView(outcome) {
  const last = outcome.sessions.at(-1)

  return el(
    'article',
    { class: 'mx-plate me-mode' },
    el('h3', { class: 'mx-h3' }, outcome.title),
    el('span', { class: 'mx-label' }, 'Memory after six sessions'),
    el('div', { class: 'me-documents' }, ...last.memory.map(documentView)),
    ...last.pending.map((note) =>
      el(
        'div',
        { class: 'mx-callout' },
        el('p', {}, el('b', {}, 'Held note: '), `“${note.text}”`),
      ),
    ),
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, `What changed · ${outcome.sessions.length} sessions`),
      el('div', { class: 'me-history' }, ...outcome.sessions.map(sessionRow)),
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  const outcomes = []
  const verdictLine = document.getElementById('verdict')
  notice.replaceChildren()
  document.getElementById('scores').replaceChildren()
  document.getElementById('modes').replaceChildren()
  document.getElementById('score-box').hidden = true
  verdictLine.hidden = true
  document.getElementById('empty').hidden = true

  await busy(button, 'Running…', async () => {
    for (const [index, mode] of MODES.entries()) {
      notice.textContent = `Running mode ${index + 1} of ${MODES.length}…`
      try {
        outcomes.push(await call('run', { mode, ...picker.value() }))
      } catch (error) {
        showError(notice, error)
        document.getElementById('empty').hidden = outcomes.length > 0
        return
      }

      const outcome = outcomes.at(-1)
      verdictLine.textContent = outcomes.map(verdict).join(' ')
      verdictLine.hidden = false
      document.getElementById('scores').append(scoreRow(outcome))
      document.getElementById('score-box').hidden = false
      document.getElementById('modes').append(modeView(outcome))
    }
    notice.replaceChildren()
  })
})
