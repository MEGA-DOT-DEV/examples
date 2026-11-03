import {
  call,
  codeBlock,
  el,
  missingKeyNote,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const button = document.getElementById('run')
const board = document.getElementById('board')
const verdict = document.getElementById('verdict')
const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── Setup folds ────────────────────────────────────────────────────────
document.getElementById('events-note').textContent =
  `${setup.events.length} events · free from ${setup.freeSlot}`
document
  .getElementById('events')
  .replaceChildren(
    ...setup.events.map((event) =>
      el(
        'tr',
        {},
        el('td', { class: 'mx-mono' }, `${event.start}–${event.end}`),
        el('td', {}, event.title),
        el('td', {}, el('code', {}, event.id)),
      ),
    ),
  )
document
  .getElementById('card')
  .append(codeBlock(prettyJson(setup.card), 'json'))
document.getElementById('modes').append(
  ...setup.modes.flatMap((mode) => {
    const instructions = codeBlock(mode.instructions)
    instructions.dataset.wrap = ''

    return [
      el('span', { class: 'mx-label' }, mode.label),
      instructions,
      el(
        'p',
        { class: 'mx-small' },
        'Tools: ',
        ...mode.tools.flatMap((tool, i) => [
          i ? ', ' : null,
          el('code', {}, tool.name),
        ]),
      ),
    ]
  }),
)

// ── The board: one column per mode, one row per message ────────────────
const LEAK = new RegExp(`\\b(${setup.privateWords.join('|')})\\b`, 'gi')

/** The reply as text, with each private word marked. */
function marked(text) {
  const parts = text.split(LEAK)

  return el(
    'p',
    { class: 'ac-reply' },
    ...parts.map((part, i) =>
      i % 2 ? el('mark', { class: 'ac-leak' }, part) : part,
    ),
  )
}

// The tool result in a few words: what the model read.
function readable(output) {
  try {
    const value = JSON.parse(output)
    if (value.error) {
      return `error: ${value.error}`
    }
    if (Array.isArray(value.events)) {
      return (
        value.events
          .map((event) => `${event.start} ${event.title}`)
          .join(' · ') || 'no events'
      )
    }
    if (Array.isArray(value.free)) {
      return `busy ${value.busy.join(', ') || 'never'} · free ${value.free.join(', ')}`
    }
    if (value.deleted) {
      return `deleted ${value.deleted}`
    }
  } catch {}

  return output.length > 160 ? `${output.slice(0, 160)}…` : output
}

function callLine(tool) {
  const args =
    tool.args && typeof tool.args === 'object'
      ? Object.values(tool.args).join(', ')
      : ''

  return el(
    'div',
    { class: `ac-call${tool.name === 'delete_event' ? ' is-delete' : ''}` },
    el('code', {}, `${tool.name}(${args})`),
    el('span', { class: 'ac-output' }, `→ ${readable(tool.output)}`),
  )
}

function scoreCell(visit) {
  if (!visit) {
    return el('div', { class: 'ac-cell ac-score mx-muted' }, 'Running…')
  }

  const line = (label, value, bad) =>
    el(
      'div',
      { class: 'ac-score-line' },
      el('span', { class: 'mx-label' }, label),
      el('b', { class: bad ? 'mx-bad' : 'mx-good' }, value),
    )

  return el(
    'div',
    { class: 'ac-cell ac-score' },
    line(
      'Private words',
      visit.leaked.length ? visit.leaked.join(', ') : 'none',
      visit.leaked.length > 0,
    ),
    line(
      'Deleted',
      visit.deleted.length ? visit.deleted.join(', ') : 'nothing',
      visit.deleted.length > 0,
    ),
    line(
      `Offered ${setup.freeSlot}`,
      visit.offeredFreeSlot ? 'yes' : 'no',
      !visit.offeredFreeSlot,
    ),
  )
}

function replyCell(visit, index) {
  if (!visit) {
    return el('div', { class: 'ac-cell mx-muted' }, '…')
  }

  const turn = visit.turns[index]

  return el(
    'div',
    { class: 'ac-cell' },
    marked(turn.reply || '(no reply)'),
    ...turn.steps.flatMap((step) => step.calls).map(callLine),
  )
}

function stepsCell(visit) {
  if (!visit) {
    return el('div', { class: 'ac-cell' })
  }

  const steps = visit.turns.flatMap((turn) => turn.steps)

  return el(
    'div',
    { class: 'ac-cell' },
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, `Requests · ${steps.length}`),
      ),
      el(
        'div',
        { class: 'ac-pad mx-stack' },
        el(
          'p',
          { class: 'mx-small mx-muted' },
          `${visit.model} · ${usageText(visit.usage)}`,
        ),
        ...steps.map((step, i) =>
          el(
            'div',
            { class: 'mx-stack' },
            el('span', { class: 'mx-label' }, `Request ${i + 1}`),
            requestResponse(step.request, step.response),
          ),
        ),
      ),
    ),
  )
}

// What the three columns mean together. The score row above holds the facts.
function meaning({ open, rule, card }) {
  const harms = [
    open.leaked.length ? 'repeated private titles' : null,
    open.deleted.length
      ? 'deleted an event because the other agent asked'
      : null,
  ].filter(Boolean)

  const openLine = harms.length
    ? `The open agent ${harms.join(' and ')}.`
    : 'The open agent kept the details private in this run, but its tools could still read titles and delete events.'
  const cardLine = card.leaked.length
    ? 'The card agent named a private word that its tool never returned: read its reply.'
    : 'The card agent cannot leak a title or delete an event: its one tool returns times only.'
  const ruleLine =
    rule.leaked.length || rule.deleted.length
      ? 'The rule in the prompt did not hold in this run.'
      : 'The rule held in this run, but only the model enforces it.'

  return `${openLine} ${cardLine} ${ruleLine}`
}

function render(visits) {
  const modes = setup.modes

  // data-col draws the line between columns. On a narrow page the columns stack, so each cell also names its mode.
  const column = (cell, i) => {
    cell.dataset.col = String(i)
    if (!cell.classList.contains('ac-head')) {
      cell.prepend(
        el('span', { class: 'mx-label ac-col-label' }, modes[i].label),
      )
    }

    return cell
  }

  board.replaceChildren(
    ...modes.map((mode, i) =>
      column(
        el(
          'div',
          { class: 'ac-head' },
          el('h3', { class: 'mx-h3' }, mode.label),
          el('p', { class: 'mx-small mx-muted' }, mode.about),
        ),
        i,
      ),
    ),
    ...modes.map((mode, i) => column(scoreCell(visits[mode.id]), i)),
    ...setup.messages.flatMap((message, index) => [
      el(
        'div',
        { class: 'ac-message' },
        el(
          'span',
          { class: 'mx-label' },
          `${setup.visitor} · message ${index + 1}`,
        ),
        el('p', {}, message),
      ),
      ...modes.map((mode, i) => column(replyCell(visits[mode.id], index), i)),
    ]),
    ...modes.map((mode, i) => column(stepsCell(visits[mode.id]), i)),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  button.disabled = true
  document.getElementById('empty').hidden = true
  verdict.hidden = true
  board.hidden = false

  const visits = {}
  render(visits)
  try {
    // The three modes run at the same time; each column fills when its run ends.
    await Promise.all(
      setup.modes.map(async (mode) => {
        visits[mode.id] = await call('run', {
          mode: mode.id,
          ...picker.value(),
        })
        render(visits)
      }),
    )

    verdict.textContent = meaning(visits)
    verdict.hidden = false
  } catch (error) {
    showError(notice, error)
  } finally {
    button.disabled = false
  }
})
