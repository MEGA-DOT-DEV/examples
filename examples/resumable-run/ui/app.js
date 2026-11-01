import {
  call,
  el,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const picker = await providerPicker(document.getElementById('picker'))
const config = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const lead = document.getElementById('lead')
const verdict = document.getElementById('verdict')
const readouts = document.getElementById('readouts')
const reason = document.getElementById('reason')
const cards = document.getElementById('cards')
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// Words for each job: the button label, the action in a sentence, the unit in a count.
const WORDS = {
  mail: {
    label: 'Send email',
    verb: 'sent',
    did: 'sent the email',
    one: 'email',
    many: 'emails',
  },
  refund: {
    label: 'Pay refund',
    verb: 'paid',
    did: 'paid the refund',
    one: 'refund',
    many: 'refunds',
  },
}
const ABOUT = {
  restart: 'Ignores the saved thread. The model chooses the action again.',
  thread: 'Loads the saved thread and runs the pending tool call.',
  intent:
    'Saves an intent with an idempotency key before the action. The outside service skips a key it already has.',
}
const SESSIONS = {
  1: 'asks for approval',
  2: 'approves, acts, crashes',
  3: 'recovers',
}
let job = 'mail'
let results = []

const jobs = document.getElementById('jobs')
function pickJob(id) {
  job = id
  for (const b of jobs.children) {
    b.setAttribute('aria-pressed', String(b.dataset.job === id))
  }
}
jobs.append(
  ...config.jobs.map((item) =>
    el(
      'button',
      {
        type: 'button',
        'data-job': item.id,
        title: item.title,
        onclick: () => pickJob(item.id),
      },
      WORDS[item.id].label,
    ),
  ),
)
pickJob(job)

const count = (run) =>
  `${run.effects.length} ${run.effects.length === 1 ? WORDS[run.job].one : WORDS[run.job].many}`
const names = (runs) =>
  runs.map((run) => config.modeNames[run.mode]).join(' and ')

function readout(run, mode) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, config.modeNames[mode]),
    el(
      'b',
      { class: run ? (run.duplicates ? 'mx-bad' : 'mx-good') : 'mx-muted' },
      run ? count(run) : '…',
    ),
  )
}

function sessionView(run, number) {
  const steps = run.trace.filter((entry) => entry.session === number)
  const pid = steps.find((entry) => entry.event === 'process')?.detail

  return el(
    'div',
    { class: 'rr-session' },
    el(
      'div',
      { class: 'mx-spread' },
      el('b', {}, `Session ${number} · ${SESSIONS[number]}`),
      pid ? el('span', { class: 'mx-small mx-muted' }, `process ${pid}`) : null,
    ),
    el(
      'ol',
      {},
      steps
        .filter((entry) => entry.event !== 'process')
        .map((entry) =>
          el(
            'li',
            { class: `rr-${entry.event}` },
            el('strong', {}, config.eventNames[entry.event] ?? entry.event),
            ` · ${entry.detail}`,
          ),
        ),
    ),
  )
}

function card(run) {
  const calls = run.trace.filter((entry) => entry.request)

  return el(
    'article',
    { class: 'mx-panel rr-card' },
    el(
      'div',
      {},
      el(
        'h3',
        { class: 'mx-h3' },
        config.modeNames[run.mode],
        ' ',
        el('code', { class: 'mx-small' }, run.mode),
      ),
      el('p', { class: 'mx-small' }, ABOUT[run.mode]),
    ),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${run.finished ? 'Job finished' : 'Job not finished'} · ${usageText(run.usage)}`,
    ),
    ...[1, 2, 3].map((number) => sessionView(run, number)),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el(
          'span',
          { class: 'mx-label' },
          `Requests and responses · ${calls.length} model calls`,
        ),
      ),
      el(
        'div',
        { class: 'mx-stack rr-raw' },
        calls.flatMap((entry, i) => [
          el(
            'span',
            { class: 'mx-label' },
            `Model call ${i + 1} · session ${entry.session}`,
          ),
          requestResponse(entry.request, entry.response),
        ]),
      ),
    ),
  )
}

// The verdict compares how often each mode ran the action. It is shown once every mode is done.
function verdictText() {
  const words = WORDS[results[0].job]
  const once = results.filter((run) => run.effects.length === 1)
  const again = results.filter((run) => run.effects.length > 1)

  if (!again.length) {
    return `Every mode ${words.did} once.`
  }
  if (!once.length) {
    return `Every mode ${words.did} again after the crash.`
  }
  return `Only ${names(once)} ${words.did} once. ${names(again)} ${words.verb} it again after the crash.`
}

function draw(done) {
  readouts.hidden = false
  readouts.replaceChildren(
    ...config.modes.map((mode) =>
      readout(
        results.find((run) => run.mode === mode),
        mode,
      ),
    ),
  )

  cards.replaceChildren(...results.map(card))
  verdict.hidden = !done
  reason.hidden = !done

  if (done) {
    verdict.textContent = verdictText()
    lead.textContent =
      'How often the outside service ran the action in each recovery mode.'
    reason.textContent =
      'The saved thread keeps the tool call, but not whether the action ran. Only the idempotency key lets the outside service skip a repeat.'
  }
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  button.disabled = true
  for (const b of jobs.children) {
    b.disabled = true
  }

  results = []
  draw(false)

  try {
    for (const [i, mode] of config.modes.entries()) {
      lead.textContent = `Running ${config.modeNames[mode]} (${i + 1} of ${config.modes.length}). Each mode starts 3 processes.`
      results.push(await call('run', { mode, job, ...picker.value() }))
      draw(results.length === config.modes.length)
    }
  } catch (error) {
    showError(notice, error)
    lead.textContent = 'The run stopped. See the error above.'
  } finally {
    button.disabled = false
    for (const b of jobs.children) {
      b.disabled = false
    }
  }
})
