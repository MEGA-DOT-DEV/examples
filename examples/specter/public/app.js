// The page owns only a log cursor. The server owns runs, receipts, the agenda,
// the first look, and the simulation. Each row shows as one plain sentence
// (`words.js`); "Show log details" adds the row as the log holds it.
import {
  addedLines,
  capital,
  costSay,
  count,
  deliverySay,
  duration,
  eventSay,
  failureSay,
  faultSay,
  gap,
  nameOf,
  parse,
  RESULTS,
  refusalSay,
  revertSay,
  SWITCH_LIST,
  sayFirst,
  span,
  switchSay,
  timeSay,
  whyNowOf,
} from './words.js'

const $ = (id) => document.getElementById(id)
const rowLog = []
/**
 * Rows by id and by key: a run finds the row that woke it, and an email intent
 * finds its receipt.
 */
const byId = new Map()
const byKey = new Map()
/**
 * Every simulation start in the log, oldest first: a time shows as +m:ss after
 * the newest start before it.
 */
const starts = []
let cursor = 0
let lastSeen = null
/**
 * The newest `GET /api/state` and `GET /api/outbox`, and the server clock minus
 * this page's clock.
 */
let latest = null
let deliveries = []
let skew = 0
/** The timeline beat last scrolled into view. */
let shownBeat = null
let selectedFile = null
let fileListSignature = ''
let sampleSignature = ''
let inboxSignature = ''
/** How long the header keeps telling a lab crash after the node is back. */
const CRASH_NOTICE_MS = 12_000

const node = (tag, className, text) => {
  const element = document.createElement(tag)
  if (className) {
    element.className = className
  }
  if (text !== undefined) {
    element.textContent = String(text)
  }
  return element
}
const append = (parent, ...children) => {
  for (const child of children) {
    parent.append(child)
  }
  return parent
}
const empty = (parent, message) =>
  parent.replaceChildren(node('p', 'empty', message))
const serverNow = () => Date.now() + skew
const wall = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
/**
 * `+m:ss` from the start of its simulation; a row of an earlier simulation
 * names it. Before any simulation: the clock time.
 */
function when(value) {
  const start = starts.findLast((candidate) => candidate.at <= value)
  if (!start) {
    return wall(value)
  }
  const offset = `+${span(value - start.at)}`
  return start === starts.at(-1) ? offset : `sim ${start.n} · ${offset}`
}
/** A time ahead, from now: "in 0:42", "in 23 h 59 min", or "due now". */
function countdown(at, now) {
  const ms = at - now
  if (ms <= 0) {
    return 'due now'
  }
  return ms < 3_600_000
    ? `in ${span(ms)}`
    : `in ${Math.floor(ms / 3_600_000)} h ${Math.floor((ms % 3_600_000) / 60_000)} min`
}
function stamp(value) {
  const element = node('time', 'meta', when(value))
  element.dateTime = new Date(value).toISOString()
  element.title = new Date(value).toLocaleString()
  return element
}
/** A line as the log holds it. It shows only while "Show log details" is on. */
const wire = (text) => node('p', 'wire', text)
const rowWire = (row) =>
  wire(
    `#${row.id} · ${row.kind} · ${row.from} → ${row.to}${row.key ? ` · key ${row.key}` : ''}`,
  )

async function api(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options })
  if (response.status === 404) {
    throw new Error('not available yet')
  }
  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => null))?.error ??
        `HTTP ${response.status}`,
    )
  }
  return response.json()
}
const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
/**
 * Post one event as the user. With its source off in config.yaml, host code
 * records a refusal instead, and this throws it in words.
 */
async function sendEvent(event) {
  const row = await post('/api/events', event)
  if (row.kind === 'refused') {
    throw new Error(refusalSay(row))
  }
  return row
}
function connection(up) {
  $('connection').classList.toggle('down', !up)
  $('connection-text').textContent = up
    ? 'Node live'
    : `Node down · last seen ${lastSeen ? wall(lastSeen) : 'never'}`
}

// Events in: what reaches Specter, and what its first look decides.

/**
 * The user's activity, feedback on Specter's work, a wake from the clock, a
 * message between instances, and each first look.
 */
function inbound(row) {
  if (row.kind === 'look') {
    return true
  }
  if (['email:adam', 'mcp:adam', 'git', 'clock'].includes(row.from)) {
    return ['message', 'edit', 'time', 'outcome'].includes(row.kind)
  }
  return (
    row.kind === 'message' &&
    row.from.startsWith('instance:') &&
    row.to.startsWith('instance:')
  )
}
function eventView(row) {
  const { head, text } = eventSay(row)
  let className = 'entry'
  if (row.kind === 'look') {
    className = `entry look ${parse(row.result)?.decision ?? ''}`
  } else if (row.kind === 'outcome') {
    className = 'entry outcome'
  } else if (row.from.startsWith('instance:')) {
    className = 'entry peer'
  }
  const item = node('article', className)
  append(
    item,
    append(node('div', 'entry-head'), node('strong', '', head), stamp(row.at)),
    node('p', 'body-text', text),
  )
  const lines = addedLines(row)
  if (lines.length) {
    append(item, node('p', 'quote', lines.join('\n')))
  }
  if (row.kind === 'look') {
    const { rows = [], model } = parse(row.result) ?? {}
    const cost = costSay(row.cost)
    append(
      item,
      node(
        'p',
        'tag',
        [`events ${rows.map((id) => `#${id}`).join(', ')}`, model, cost]
          .filter(Boolean)
          .join(' · '),
      ),
    )
  }
  append(item, rowWire(row))
  return item
}
/**
 * A simulation start or end: the line that separates one simulation's rows from
 * the next.
 */
function simDivider(row) {
  const n = row.key?.split(':')[1]
  const text =
    row.kind === 'sim.started'
      ? `Simulation ${n} starts · +0:00 is ${wall(row.at)}`
      : row.body
  return append(node('div', 'divider sim'), node('span', '', text))
}
function renderEvents() {
  const rows = rowLog.filter(
    (row) =>
      inbound(row) || row.kind === 'sim.started' || row.kind === 'sim.ended',
  )
  const events = rows.filter(inbound).length
  $('event-count').textContent = events ? String(events) : ''
  if (!events) {
    return
  }
  $('events').replaceChildren(
    ...rows
      .toReversed()
      .map((row) => (inbound(row) ? eventView(row) : simDivider(row))),
  )
}

// Runs: each wake and its steps, as sentences.

/**
 * celld also starts an idle cell again at its next request or alarm: only a lab
 * crash just before a start is a crash.
 */
function bootSay(row) {
  const before = rowLog.findLast(
    (candidate) =>
      candidate.id < row.id &&
      (candidate.kind === 'boot' || candidate.kind === 'fault'),
  )
  if (!before) {
    return { text: 'The node starts.', tone: 'lab' }
  }
  if (before.body.startsWith('lab crash')) {
    return {
      text: `The node starts again ${gap(row.at - before.at)} after the crash. Every run goes on from its last durable step.`,
      tone: 'crash',
    }
  }
  return {
    text: 'The node starts again after an idle pause or a restart, not a lab crash. Every run goes on from its last durable step.',
    tone: 'lab',
  }
}
/**
 * A decision record in words: the step on the ladder, with the reason as the
 * run gave it.
 */
function decisionSay(row) {
  const {
    level = row.body.split(':')[0],
    reason = '',
    missing = false,
  } = parse(row.result) ?? {}
  return {
    text: `Decision: ${level}.`,
    quote: reason,
    tone: missing ? 'decision missing' : 'decision',
  }
}
/**
 * The next wake a decision saw, counted from the decision: a heartbeat a day
 * ahead reads "in 23 h 59 min", not a long +m:ss.
 */
function nextAfter(row, next) {
  return next
    ? `Next wake, as this run left it: ${countdown(Date.parse(next.at), row.at)}, ${next.why}`
    : 'No next wake on the agenda.'
}
/**
 * One row of a run, or a host or lab row beside it, in words: a sentence, an
 * optional quote, and a tone for its mark.
 */
function stepSay(row) {
  if (row.kind === 'result') {
    return row.to === 'email:adam'
      ? deliverySay(row)
      : {
          text: sayFirst(RESULTS, row.body, row.body),
          tone: row.body.startsWith('wrote') ? 'write' : 'read',
        }
  }
  if (row.kind === 'message') {
    return {
      text:
        row.to === 'mcp:adam'
          ? 'Leaves the user a message to pull (mcp):'
          : `Writes to ${nameOf(row.to)}:`,
      quote: row.body,
      tone: 'message',
    }
  }
  if (row.kind === 'intent') {
    return {
      text: 'About to email the user. The receipt key is recorded first, so a retry finds it and does not send twice.',
      quote: row.body,
      tone: 'email',
    }
  }
  if (row.kind === 'refused') {
    return { text: refusalSay(row), tone: 'refused' }
  }
  if (row.kind === 'decision') {
    return decisionSay(row)
  }
  // The final answer is the model's own words, so it shows as a quote, not as
  // the page's sentence.
  if (row.kind === 'run.ended') {
    const answer = parse(row.body)?.answer
    return answer
      ? { text: 'Done. Its final answer:', quote: answer, tone: 'end' }
      : { text: 'Done, with no final answer.', tone: 'end' }
  }
  if (row.kind === 'run.failed') {
    const reason = parse(row.body)?.reason ?? row.body
    return {
      text:
        reason === 'aborted'
          ? 'Paused: config.yaml paused Specter, and host code aborted this run.'
          : `Failed: ${failureSay(reason)}.`,
      tone: 'failed',
    }
  }
  if (row.kind === 'revert') {
    return revertSay(row)
  }
  if (row.kind === 'config') {
    return { text: `The user’s config: ${row.body}.`, tone: 'host' }
  }
  if (row.kind === 'clock') {
    return {
      text: `Lab: ${row.body}. Agenda times and the heartbeat come that much sooner.`,
      tone: 'lab',
    }
  }
  if (row.kind === 'boot') {
    return bootSay(row)
  }
  if (row.kind === 'fault') {
    return faultSay(row)
  }
  return { text: row.body, tone: '' }
}
/**
 * The first step of a run: why it woke, and how many new events this one wake
 * read.
 */
function wakeSay(row, read) {
  const why = row.body.slice(row.body.indexOf(' Why: ') + 6) || row.body
  if (!read || read.total < 2) {
    return { text: 'Wakes up. Why:', quote: why, tone: 'start' }
  }
  const kinds = Object.entries(read.kinds).map(([kind, n]) => count(n, kind))
  return {
    text: `Wakes up once and reads ${read.total} new events in this one run: ${kinds.join(' and ')}. Why:`,
    quote: why,
    tone: 'start',
  }
}
/**
 * The events each ended run read: the rows to its instance after the cursor of
 * the instance's run before it, minus those a first look ignored.
 */
function eventsRead() {
  const reads = new Map()
  const cursors = new Map()
  const nouns = {
    message: 'message',
    edit: 'edit',
    time: 'wake time',
    outcome: 'outcome',
  }
  const ignored = new Set(
    rowLog.flatMap((row) =>
      row.kind === 'look' && parse(row.result)?.decision === 'ignore'
        ? (parse(row.result)?.rows ?? [])
        : [],
    ),
  )
  for (const end of rowLog) {
    if (end.kind !== 'run.ended' && end.kind !== 'run.failed') {
      continue
    }
    const to = parse(end.body)?.cursor
    if (typeof to !== 'number') {
      continue
    }
    const from = cursors.get(end.from) ?? 0
    cursors.set(end.from, Math.max(from, to))
    const read = rowLog.filter(
      (row) =>
        row.id > from &&
        row.id <= to &&
        (row.to === end.from || row.to === '*') &&
        row.from !== end.from &&
        nouns[row.kind] &&
        !ignored.has(row.id),
    )
    const kinds = {}
    for (const row of read) {
      kinds[nouns[row.kind]] = (kinds[nouns[row.kind]] ?? 0) + 1
    }
    reads.set(end.run, { total: read.length, kinds })
  }
  return reads
}
/**
 * An email that reached the user's inbox while its run has not written the
 * receipt row yet: the window the lab crash cuts. A run that ended without the
 * receipt (aborted by a pause) will never write it, so its email is not in
 * flight.
 */
function inFlight(key) {
  const intent = byKey.get(key)
  if (intent?.kind !== 'intent' || byKey.has(`${key}:result`)) {
    return false
  }
  if (
    byKey.has(`run.ended:${intent.run}`) ||
    byKey.has(`run.failed:${intent.run}`)
  ) {
    return false
  }
  return deliveries.some((delivery) => delivery.key === key)
}
function stepView(row, read, rows) {
  const { text, quote, tone } =
    row.kind === 'run.started' ? wakeSay(row, read) : stepSay(row)
  const item = node('li', `step ${tone}`)
  append(
    item,
    append(
      node('div', 'step-head'),
      node('p', 'step-text', text),
      stamp(row.at),
    ),
  )
  if (quote) {
    append(item, node('p', 'quote', quote))
  }
  if (row.to === 'email:adam' || row.to === 'mcp:adam') {
    const why = whyNowOf(row)
    if (row.kind !== 'result') {
      append(
        item,
        node(
          'p',
          why ? 'why-now' : 'why-now absent',
          why ? `Why now: ${why}` : 'No why_now given.',
        ),
      )
    }
  }
  if (row.kind === 'decision') {
    const { evidence, missing, next = null } = parse(row.result) ?? {}
    append(item, node('p', 'meta-line', nextAfter(row, next)))
    if (evidence) {
      append(item, node('p', 'meta-line', `Evidence: ${evidence}`))
    }
    if (missing) {
      append(
        item,
        node(
          'p',
          'alert',
          'The run wrote no decision record. Host code wrote this one from what the run did, and marks it missing.',
        ),
      )
    }
  }
  if (row.kind === 'intent' && inFlight(row.key)) {
    append(
      item,
      node(
        'p',
        'alert',
        'In the user’s inbox now. Its receipt is not written yet.',
      ),
    )
  }
  // A restart in the middle of this run's email: the intent came before it, and
  // its receipt after it or not yet.
  const cut = (intent) =>
    intent.kind === 'intent' &&
    intent.id < row.id &&
    !(
      (byKey.get(`${intent.key}:result`)?.id ?? Number.POSITIVE_INFINITY) <
      row.id
    )
  if (row.kind === 'boot' && tone === 'crash' && rows.some(cut)) {
    append(
      item,
      node(
        'p',
        'alert',
        'An email was in flight. Watch the user’s inbox: it gets that email once, not twice.',
      ),
    )
  }
  append(item, rowWire(row))
  return item
}
function runView(id, rows, read) {
  const card = node('article', id === 'host' ? 'run host' : 'run')
  const end = rows.find(
    (row) => row.kind === 'run.ended' || row.kind === 'run.failed',
  )
  const actor = rows.find((row) => row.from.startsWith('instance:'))?.from
  const head = node('div', 'run-head')
  if (id === 'host') {
    append(head, node('p', 'run-title', 'Host code, no model run'))
  } else {
    let status = 'running'
    if (end?.kind === 'run.ended') {
      status = 'done'
    } else if (end) {
      status = parse(end.body)?.reason === 'aborted' ? 'paused' : 'failed'
    }
    const time = end
      ? `${when(rows[0].at)} → ${when(end.at)}`
      : `since ${when(rows[0].at)}`
    const cost = end ? costSay(end.cost) : ''
    append(
      head,
      node(
        'p',
        'run-title',
        `${capital(nameOf(actor ?? 'instance:specter'))} · run ${id}`,
      ),
      node('span', `badge ${status}`, status),
      node('span', 'meta', cost ? `${time} · ${cost}` : time),
    )
  }
  // The decision record closes the run: it shows last, after the run's end.
  const steps = [
    ...rows.filter((row) => row.kind !== 'decision'),
    ...rows.filter((row) => row.kind === 'decision'),
  ]
  append(
    card,
    head,
    append(
      node('ol', 'steps'),
      ...steps.map((row) => stepView(row, read, rows)),
    ),
  )
  return card
}
/**
 * The row that woke a run, as the title above it: a first look with the events
 * it read, a time on the agenda, or a peer's message.
 */
function causeTitle(trigger) {
  if (trigger.kind === 'look') {
    const { reason = trigger.body, rows = [] } = parse(trigger.result) ?? {}
    const events = rows.flatMap((id) =>
      byId.has(id) ? [eventSay(byId.get(id)).head] : [],
    )
    return `First look woke Specter: ${reason}${events.length ? ` · It read: ${events.join('; ')}` : ''}`
  }
  const { head, text } = inbound(trigger)
    ? eventSay(trigger)
    : { head: capital(nameOf(trigger.from)), text: trigger.body }
  return trigger.kind === 'message' ? `${head}: “${text}”` : `${head}. ${text}`
}
function causeView(cause, runs, reads) {
  const group = node('div', 'cause')
  const trigger = byId.get(cause)
  if (trigger) {
    const title = node('p', 'cause-title', causeTitle(trigger))
    title.title = title.textContent
    append(group, title)
  }
  for (const [id, rows] of runs) {
    append(group, runView(id, rows, reads.get(id)))
  }
  return group
}
/**
 * A lab or host row between the runs: a simulation start or end, a node start,
 * a fault switch, a config version, a clock move, a refusal with no run.
 */
function labLine(row) {
  if (row.kind === 'sim.started' || row.kind === 'sim.ended') {
    return simDivider(row)
  }
  const { text, tone } = stepSay(row)
  const line = append(
    node('div', `lab-line ${tone}`),
    node('p', '', text),
    stamp(row.at),
  )
  return append(node('div', ''), line, rowWire(row))
}
// A revert and a refused wake are host rows: they show under the run or the
// event that caused them.
const traceKinds = new Set([
  'run.started',
  'intent',
  'result',
  'refused',
  'run.ended',
  'run.failed',
  'revert',
  'decision',
])
const labKinds = new Set([
  'boot',
  'fault',
  'sim.started',
  'sim.ended',
  'config',
  'clock',
])
const isLab = (row) =>
  labKinds.has(row.kind) ||
  (row.kind === 'refused' && row.cause == null && !row.run)
function renderRuns() {
  const groups = new Map()
  for (const row of rowLog) {
    if (row.cause == null || (!row.run && !traceKinds.has(row.kind))) {
      continue
    }
    if (!groups.has(row.cause)) {
      groups.set(row.cause, { first: row.id, runs: new Map() })
    }
    const runs = groups.get(row.cause).runs
    const key = row.run ?? 'host'
    if (!runs.has(key)) {
      runs.set(key, [])
    }
    runs.get(key).push(row)
  }
  // A crash, a restart, or a fault during a run shows between the steps it cut.
  // One run is live at a time.
  const spans = []
  for (const group of groups.values()) {
    for (const [id, rows] of group.runs) {
      if (id === 'host') {
        continue
      }
      const end = rows.find(
        (row) => row.kind === 'run.ended' || row.kind === 'run.failed',
      )
      spans.push({
        rows,
        from: rows[0].id,
        to: end?.id ?? Number.POSITIVE_INFINITY,
      })
    }
  }
  const blocks = [...groups].map(([cause, group]) => ({
    first: group.first,
    cause,
    runs: group.runs,
  }))
  for (const row of rowLog) {
    if (!isLab(row)) {
      continue
    }
    const owner = ['boot', 'fault'].includes(row.kind)
      ? spans.find(
          (candidate) => candidate.from < row.id && row.id < candidate.to,
        )
      : undefined
    if (owner) {
      owner.rows.push(row)
    } else {
      blocks.push({ first: row.id, lab: row })
    }
  }
  for (const owner of spans) {
    owner.rows.sort((a, b) => a.id - b.id)
  }
  const runCount = spans.length
  $('run-count').textContent = runCount ? String(runCount) : ''
  if (!blocks.length) {
    return
  }
  const reads = eventsRead()
  // Newest first, like the events: what just happened is at the top.
  blocks.sort((a, b) => b.first - a.first)
  $('runs').replaceChildren(
    ...blocks.map((block) =>
      block.lab
        ? labLine(block.lab)
        : causeView(block.cause, block.runs, reads),
    ),
  )
}

// The user's inbox.

function deliveryView(delivery) {
  const item = node('article', 'delivery')
  append(
    item,
    append(
      node('div', 'entry-head'),
      node('strong', '', 'Email to the user'),
      stamp(delivery.at),
    ),
    node('p', 'body-text', delivery.body),
  )
  const intent = byKey.get(delivery.key)
  const why = intent && whyNowOf(intent)
  if (why) {
    append(item, node('p', 'why-now', `Why now: ${why}`))
  }
  if (inFlight(delivery.key)) {
    append(
      item,
      node(
        'p',
        'alert',
        'Receipt not written yet: the run has not recorded this delivery.',
      ),
    )
  }
  if (delivery.attempts > 1) {
    append(
      item,
      node(
        'p',
        'tag',
        `${delivery.attempts} delivery attempts, one email: the receipt absorbed the duplicate`,
      ),
    )
  }
  // The crash lesson needs a fresh email: one from an earlier simulation says
  // so, and proves nothing about this one.
  const start = starts.at(-1)
  if (start && delivery.at < start.at) {
    append(
      item,
      node('p', 'earlier', `Sent before simulation ${start.n} started.`),
    )
  }
  append(
    item,
    wire(
      `receipt ${delivery.key} · to ${delivery.to} · ${count(delivery.attempts, 'attempt')}`,
    ),
  )
  return item
}
function renderInbox() {
  $('inbox-count').textContent = deliveries.length
    ? String(deliveries.length)
    : ''
  if (!deliveries.length) {
    return empty(
      $('inbox'),
      'No emails yet. When Specter’s agenda says a digest is due, the digest lands here.',
    )
  }
  $('inbox').replaceChildren(...deliveries.toReversed().map(deliveryView))
}

// The simulation, the header, and the agenda.

/** The `time` row key of an agenda item's time, as the harness writes it. */
const agendaKey = (item) =>
  `time:agenda:${item.slug}:${new Date(item.at).toISOString()}`
/**
 * When an agenda item wakes Specter: the harness's next wake when it is this
 * item (it may hold the time for `min_sleep`), else its own time.
 */
function agendaAt(state, item) {
  return state.next?.why.startsWith(`agenda "${item.title}" is due`)
    ? state.next.at
    : item.at
}
/** The simulation's beats and Specter's own wakes during it, in time order. */
function timelineItems(state) {
  const { sim } = state
  const now = serverNow()
  const items = sim.beats.map((beat) => ({ ...beat, wake: false }))
  if (sim.started == null) {
    return items
  }
  const fired = rowLog.filter(
    (row) => row.kind === 'time' && row.from === 'clock' && row.id > sim.id,
  )
  for (const row of fired) {
    if (sim.ended && row.at > sim.ended.at) {
      continue
    }
    const { head, text } = timeSay(row)
    items.push({
      at: row.at - sim.started,
      title: head,
      say: text,
      done: row.at,
      wake: true,
    })
  }
  if (!sim.ended) {
    for (const item of state.agenda.items) {
      if (
        item.at == null ||
        item.at < sim.started ||
        byKey.has(agendaKey(item))
      ) {
        continue
      }
      const at = agendaAt(state, item)
      items.push({
        at: at - sim.started,
        title: `Specter’s agenda: “${item.title}”`,
        say: `Why: ${item.why} Next: ${item.next}`,
        done: null,
        wake: true,
        due: at <= now,
      })
    }
  }
  // A beat that ran sits at the moment it ran: a crash that waited for the
  // email lands after the wake that sent it. A beat that still waits for its
  // moment sorts at now, below what already happened; it keeps its due time as
  // its label.
  const order = (item) => {
    if (item.done != null) {
      return item.done - sim.started
    }
    return item.waits && !sim.ended && sim.started + item.at <= now
      ? now - sim.started
      : item.at
  }
  for (const item of items) {
    if (item.done != null) {
      item.at = item.done - sim.started
    }
  }
  return items.sort((a, b) => order(a) - order(b))
}
function beatStatus(item, { sim, running, due, paused, now }) {
  if (item.skipped) {
    return 'skipped'
  }
  if (item.done != null) {
    return item.wake ? 'went off' : 'done'
  }
  if (item.wake && paused) {
    return 'held by the pause'
  }
  if (running) {
    return due ? 'waiting' : `in ${span(sim.started + item.at - now)}`
  }
  if (sim.ended) {
    return 'did not run'
  }
  return ''
}
/**
 * Why the run a played beat woke failed, or nothing: the beat says what to
 * watch for, and a failed run did none of it. An abort by the pause is not a
 * failure.
 */
function failedRun(sim, item) {
  const event = byKey.get(`event:sim:${sim.n}:${item.id}:0`)
  const look =
    event &&
    rowLog.find(
      (row) =>
        row.kind === 'look' && parse(row.result)?.rows?.includes(event.id),
    )
  const failed =
    look &&
    rowLog.find((row) => row.cause === look.id && row.kind === 'run.failed')
  const reason = failed
    ? (parse(failed.body)?.reason ?? failed.body)
    : undefined
  return reason === 'aborted' ? undefined : reason
}
function beatView(item, context) {
  const { sim, running, now, live, flying, current } = context
  const done = item.done != null
  const due = !done && running && (item.due ?? sim.started + item.at <= now)
  let kind = 'pending'
  if (item.skipped) {
    kind = 'skipped'
  } else if (done) {
    kind = 'done'
  } else if (due) {
    kind = 'due'
  }
  const element = node(
    'li',
    `beat ${kind}${item.wake ? ' wake' : ''}${current && running ? ' current' : ''}`,
  )
  append(
    element,
    node('span', 'beat-time', span(item.at)),
    node('p', 'beat-title', item.title),
    node('span', 'beat-state', beatStatus(item, { ...context, due })),
  )
  if (done || item.wake) {
    append(element, node('p', 'beat-say', item.say))
  }
  const failure = done && !item.wake ? failedRun(sim, item) : undefined
  if (failure) {
    append(
      element,
      node(
        'p',
        'beat-say alert',
        `The run this beat woke failed before it finished: ${failureSay(failure)}. Runs shows which steps it did.`,
      ),
    )
  }
  if (due && !item.wake) {
    if (item.waits) {
      append(element, node('p', 'beat-say', item.waits))
    } else if (live) {
      append(
        element,
        node(
          'p',
          'beat-say',
          `Waits for ${nameOf(`instance:${live.instance}`)} to finish its run, at most ${sim.hold / 1000} s.`,
        ),
      )
    }
    if (item.waits && flying) {
      append(
        element,
        node(
          'p',
          'beat-say alert',
          'Now: an email to the user is in flight. Watch the user’s inbox: the email is there, and its receipt is not written yet.',
        ),
      )
    }
  }
  return element
}
function renderTimeline(state) {
  const { sim } = state
  const now = serverNow()
  const running = sim.started != null && !sim.ended
  $('sim-clock').textContent = running
    ? `${span(now - sim.started)} of ${span(sim.length)}`
    : ''
  const items = timelineItems(state)
  const current = items
    .filter((item) => item.done != null)
    .sort((a, b) => a.done - b.done)
    .at(-1)
  const context = {
    sim,
    running,
    now,
    live: state.live,
    paused: state.paused,
    flying: deliveries.some((delivery) => inFlight(delivery.key)),
  }
  let currentElement = null
  $('beats').replaceChildren(
    ...items.map((item) => {
      const element = beatView(item, { ...context, current: item === current })
      if (item === current) {
        currentElement = element
      }
      return element
    }),
  )
  // Each new beat scrolls into view once; between beats the visitor may scroll
  // freely.
  const list = $('beats')
  const shown = current ? `${sim.n}:${current.title}:${current.done}` : null
  if (running && currentElement && shown !== shownBeat) {
    list.scrollTop +=
      currentElement.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      list.clientHeight / 4
  }
  shownBeat = shown
}
function renderSimControl(state) {
  const { sim } = state
  const running = sim.started != null && !sim.ended
  const button = $('sim-button')
  button.textContent = running ? 'End simulation' : 'Start simulation'
  button.classList.toggle('end', running)
  button.disabled = false
  let word = 'Not started'
  let status = `About ${Math.ceil(sim.length / 60_000)} minutes of the user’s day play by themselves, starting with a paper they save in their notes.`
  if (running) {
    word = 'Running'
    status = `Simulation ${sim.n}: ${span(serverNow() - sim.started)} of ${span(sim.length)}. Follow it in the Simulation list.`
  } else if (sim.ended) {
    word = sim.ended.early ? 'Ended' : 'Finished'
    const end = sim.ended.early
      ? `ended at ${span(sim.ended.at - sim.started)}, and Specter is paused`
      : 'finished'
    status = `Simulation ${sim.n} ${end}. Its history stays below; start again any time.`
  }
  $('sim-state').textContent = word
  $('sim-state').dataset.state = word.toLowerCase().replace(' ', '-')
  $('sim-status').textContent = status
  const look =
    state.look === state.brain ? '' : ` Its first look runs on ${state.look}.`
  $('brain').textContent =
    state.brain === 'lab/brain'
      ? `Played by the offline lab brain: a scripted stand-in that answers the same way every time.${look}`
      : `Played by ${state.brain}, a real model: its answers and pace change from run to run, so each beat says what to watch for.${look}`
}
/** What wakes Specter next, in words. */
function nextWakeSay(state, now) {
  if (!state.next) {
    return 'No wake is coming.'
  }
  return `Next wake ${countdown(state.next.at, now)}: ${state.next.why}`
}
/**
 * Specter's state in one sentence: paused, awake, looking, or asleep and what
 * wakes it next.
 */
function stateSay(state, now) {
  if (state.paused) {
    return {
      text: 'Paused: config.yaml says paused: true. No wake starts, no first look runs, and nothing is sent until you switch the pause off.',
      tone: 'paused',
    }
  }
  if (state.live) {
    return {
      text: `Awake: ${nameOf(`instance:${state.live.instance}`)} is in run ${state.live.run}, since ${when(state.live.started)}.`,
      tone: 'awake',
    }
  }
  if (state.looking) {
    return {
      text: 'Looking: the first look is reading new events to decide whether they need a run.',
      tone: 'awake',
    }
  }
  return { text: `Asleep. ${nextWakeSay(state, now)}`, tone: 'asleep' }
}
/** The header line: a lab crash while it is news, else Specter's state. */
function renderNow(state) {
  const now = serverNow()
  const crash = rowLog.findLast(
    (row) => row.kind === 'fault' && row.body.startsWith('lab crash'),
  )
  const back =
    crash && rowLog.find((row) => row.kind === 'boot' && row.id > crash.id)
  let line = stateSay(state, now)
  if (crash && !back) {
    line = {
      text: `The lab killed the node at ${when(crash.at)}. It starts again at the next request or alarm.`,
      tone: 'crash',
    }
  } else if (crash && now - back.at < CRASH_NOTICE_MS) {
    line = {
      text: `The lab killed the node at ${when(crash.at)}. It was back ${gap(back.at - crash.at)} later, and the interrupted run goes on.`,
      tone: 'crash',
    }
  }
  $('now').textContent = line.text
  $('now').className = `now ${line.tone}`
}
/**
 * Who wrote the newest agenda: Specter in a run, the harness at a simulation
 * start, or the user.
 */
function agendaAuthor(agenda) {
  const who = agenda.author ? capital(nameOf(agenda.author)) : 'No one'
  const where = agenda.run ? ` in run ${agenda.run}` : ''
  return `documents/agenda.md v${agenda.version}, written by ${who}${where}.`
}
/**
 * The first look and its batch: a look in flight, or events that wait for their
 * batch to close.
 */
function lookSay(state, now) {
  if (state.looking) {
    return `A first look is reading new events now, on ${state.look}.`
  }
  if (!state.batch) {
    return ''
  }
  const closes =
    state.batch.closes > now
      ? `closes in ${span(state.batch.closes - now)}`
      : 'is closed'
  const held = state.paused ? ' The pause holds it.' : ''
  const verb = state.batch.events === 1 ? 'waits' : 'wait'
  return `${count(state.batch.events, 'new event')} ${verb} for the first look: the batch ${closes}, and one look reads it whole.${held}`
}
function renderAgenda(state) {
  const now = serverNow()
  const { text, tone } = stateSay(state, now)
  const parts = [node('p', `state-head ${tone}`, text)]
  const look = lookSay(state, now)
  if (look) {
    parts.push(node('p', 'look-line', look))
  }
  // Asleep, the state line already names the next wake.
  if ((state.live || state.looking) && !state.paused && state.next) {
    parts.push(node('p', 'next-line', nextWakeSay(state, now)))
  }
  const list = node('dl', 'agenda-items')
  for (const item of state.agenda.items) {
    const entry = append(node('div', 'agenda-item'), node('dt', '', item.title))
    let timing = 'look again: none'
    if (item.at != null) {
      const at = agendaAt(state, item)
      const label =
        when(at) === wall(at)
          ? `at ${wall(at)}`
          : `at ${when(at)} (${wall(at)})`
      if (byKey.has(agendaKey(item))) {
        timing = `went off · ${label}`
      } else if (state.paused) {
        timing = `held by the pause · ${label}`
      } else {
        timing = `${countdown(at, now)} · ${label}`
      }
    }
    append(entry, node('dd', 'agenda-when', timing))
    if (item.why) {
      append(entry, node('dd', 'agenda-line', `Why: ${item.why}`))
    }
    if (item.next) {
      append(entry, node('dd', 'agenda-line', `Next: ${item.next}`))
    }
    append(list, entry)
  }
  if (!state.agenda.items.length) {
    append(list, node('p', 'empty', 'The agenda holds no item.'))
  }
  parts.push(list)
  for (const problem of state.agenda.problems) {
    parts.push(
      node(
        'p',
        'alert',
        `Item “${problem.title}” sets no wake: ${problem.reason}.`,
      ),
    )
  }
  parts.push(node('p', 'meta-line', agendaAuthor(state.agenda)))
  parts.push(
    node(
      'p',
      'meta-line',
      `Heartbeat: with no other wake, Specter wakes ${duration(state.heartbeat)} after its last run.`,
    ),
  )
  parts.push(
    node(
      'p',
      'meta-line',
      `Limits in config.yaml: ${state.wakes.perDay} wakes a day (${state.wakes.today} so far), ${state.wakes.perCause} wakes from one cause.`,
    ),
  )
  parts.push(
    wire(
      `cell alarm: ${state.alarm ? wall(state.alarm) : 'none'} · the earliest of an agenda time, the heartbeat, a batch close, or a beat`,
    ),
  )
  $('agenda').replaceChildren(...parts)
}

// Your switches: config.yaml as the user changes it from the lab console.

/** One switch button. A press sets the opposite of the state it shows now. */
function switchButton(item) {
  const button = node('button', 'toggle')
  button.type = 'button'
  append(
    button,
    node('span', 'toggle-label', item.label),
    node('span', 'toggle-state'),
  )
  button.addEventListener('click', async () => {
    const value = button.getAttribute('aria-pressed') === 'true'
    button.disabled = true
    try {
      const { row } = await post('/api/control/config', item.change(!value))
      $('control-status').textContent = `${row.body}.`
    } catch (error) {
      $('control-status').textContent = `Switch: ${error.message}`
    } finally {
      button.disabled = false
    }
    await refreshState()
  })
  return button
}
/**
 * The buttons are built once and each poll updates them in place, so a press or
 * the keyboard focus is never lost.
 */
function renderSwitches(state) {
  const list = $('switches')
  if (list.childElementCount !== SWITCH_LIST.length) {
    list.replaceChildren(...SWITCH_LIST.map(switchButton))
  }
  for (const [index, item] of SWITCH_LIST.entries()) {
    const button = list.children[index]
    const value = item.read(state)
    // Green when the switch lets Specter work or reach the user; the pause
    // holds it when on.
    const open = item.id === 'paused' ? !value : value
    button.className = `toggle ${open ? 'open' : 'held'}`
    button.setAttribute('aria-pressed', String(value))
    button.lastChild.textContent = value ? item.on : item.off
  }
}

// Workspace.

function renderFiles(files) {
  const signature = JSON.stringify(
    files.map((file) => [file.path, file.version, file.author]),
  )
  if (signature === fileListSignature) {
    return
  }
  fileListSignature = signature
  $('file-count').textContent = String(files.length)
  if (!files.length) {
    return empty($('files'), 'No files yet.')
  }
  $('files').replaceChildren(
    ...files.map((file) => {
      const item = node('div', 'file-row')
      const button = node('button', '', file.path)
      button.type = 'button'
      button.setAttribute('aria-label', `Open ${file.path} and its versions`)
      if (file.path === selectedFile) {
        button.setAttribute('aria-current', 'true')
      }
      button.addEventListener('click', () => openFile(file.path))
      append(
        item,
        append(
          node('div', 'file-head'),
          button,
          node(
            'span',
            'meta',
            `v${file.version} · ${capital(nameOf(file.author))}`,
          ),
        ),
      )
      return item
    }),
  )
  if (selectedFile && files.some((file) => file.path === selectedFile)) {
    void openFile(selectedFile)
  }
}
async function openFile(path) {
  selectedFile = path
  for (const button of $('files').querySelectorAll('button')) {
    button.setAttribute('aria-current', String(button.textContent === path))
  }
  try {
    const detail = await api(`/api/files?path=${encodeURIComponent(path)}`)
    if (selectedFile !== path) {
      return
    }
    const list = node('ol', 'versions')
    for (const version of detail.history) {
      append(
        list,
        node(
          'li',
          '',
          `v${version.version} · ${capital(nameOf(version.author))} · ${when(version.at)}${version.run ? ` · run ${version.run}` : ''}`,
        ),
      )
    }
    $('file-detail').replaceChildren(
      node('h3', '', `${path} · v${detail.version}`),
      node('pre', '', detail.text ?? 'File deleted.'),
      list,
    )
  } catch (error) {
    empty($('file-detail'), error.message)
  }
}
function renderSamples(samples) {
  const signature = JSON.stringify(samples)
  if (signature === sampleSignature) {
    return
  }
  sampleSignature = signature
  if (!samples.length) {
    return empty($('samples'), 'No samples.')
  }
  $('samples').replaceChildren(
    ...samples.map((sample) => {
      const button = node('button', '', sample.title)
      button.type = 'button'
      button.title = `events/${sample.name}.json`
      button.addEventListener('click', async () => {
        button.disabled = true
        // Each click is a new delivery: a fresh key per click. The same key
        // twice would be one row.
        const click = Date.now().toString(36)
        try {
          for (const event of sample.events) {
            await sendEvent({
              ...event,
              key: `${event.key ?? sample.name}:${click}`,
            })
          }
          $('control-status').textContent = `Sent: ${sample.title}.`
        } catch (error) {
          $('control-status').textContent = `Sending failed: ${error.message}`
        } finally {
          button.disabled = false
        }
      })
      return button
    }),
  )
}

// The poll loop and the controls.

async function optional(path, target, render) {
  try {
    render(await api(path))
  } catch (error) {
    if (error.message === 'not available yet') {
      empty($(target), error.message)
    }
  }
}
async function refreshState() {
  try {
    const state = await api('/api/state')
    latest = state
    skew = state.now - Date.now()
    connection(true)
    renderSimControl(state)
    renderTimeline(state)
    renderAgenda(state)
    renderSwitches(state)
    renderNow(state)
  } catch {
    /* the row poll reports the connection */
  }
}
/**
 * Fetch the user's inbox. True when a delivery changed: the inbox renders
 * again, and so do the runs, whose email steps say whether the email arrived.
 */
async function refreshInbox() {
  try {
    deliveries = await api('/api/outbox')
  } catch {
    return false
  }
  const signature = JSON.stringify(
    deliveries.map((delivery) => [delivery.key, delivery.attempts]),
  )
  if (signature === inboxSignature) {
    return false
  }
  inboxSignature = signature
  return true
}
let polls = 0
async function poll() {
  let changed = false
  try {
    const rows = await api(`/api/rows?after=${cursor}`)
    lastSeen = Date.now()
    connection(true)
    for (const row of rows) {
      rowLog.push(row)
      byId.set(row.id, row)
      if (row.key) {
        byKey.set(row.key, row)
      }
      if (row.kind === 'sim.started') {
        starts.push({ at: row.at, n: Number(row.key?.split(':')[1]) })
      }
      cursor = Math.max(cursor, row.id)
    }
    changed = rows.length > 0
    if (changed) {
      renderEvents()
    }
  } catch {
    connection(false)
  }
  if ((await refreshInbox()) || changed) {
    renderInbox()
    renderRuns()
  }
  await refreshState()
  if (polls++ % 4 === 0) {
    await Promise.all([
      optional('/api/files', 'files', renderFiles),
      optional('/api/samples', 'samples', renderSamples),
    ])
  }
  setTimeout(poll, 500)
}

$('sim-button').addEventListener('click', async () => {
  const button = $('sim-button')
  const running = latest?.sim.started != null && !latest.sim.ended
  button.disabled = true
  try {
    await post(running ? '/api/sim/end' : '/api/sim/start', {})
  } catch (error) {
    $('sim-status').textContent =
      `${running ? 'End' : 'Start'} failed: ${error.message}`
  }
  await refreshState()
})
// The log details stay on or off across reloads: a visitor who wants the wire
// format wants it every time.
const wireToggle = $('wire-toggle')
wireToggle.checked = localStorage.getItem('specter.wire') === '1'
document.body.classList.toggle('show-wire', wireToggle.checked)
wireToggle.addEventListener('change', () => {
  localStorage.setItem('specter.wire', wireToggle.checked ? '1' : '0')
  document.body.classList.toggle('show-wire', wireToggle.checked)
})
$('link-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const input = $('link')
  const url = input.value.trim()
  // A new reading note per save, as the user would add one to their notes.
  const path = `notes/reading/saved-${Date.now().toString(36)}.md`
  try {
    await sendEvent({
      from: 'git',
      kind: 'edit',
      path,
      text: `# Saved link\n\nSaved from ${url}\n`,
      body: 'Saved a link',
    })
    $('control-status').textContent = `Saved ${url} in ${path}, as the user.`
    input.value = ''
  } catch (error) {
    $('control-status').textContent = `Save failed: ${error.message}`
  }
})
$('message-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const input = $('message')
  try {
    await sendEvent({ from: 'email:adam', kind: 'message', body: input.value })
    $('control-status').textContent =
      `Sent the user’s message: “${input.value}”.`
    input.value = ''
  } catch (error) {
    $('control-status').textContent = `Message failed: ${error.message}`
  }
})
$('crash').addEventListener('click', async () => {
  try {
    await post('/api/control/crash', {})
    $('control-status').textContent =
      'Crash requested: the node starts again at the next request. Watch Runs and the line under the Start button.'
  } catch (error) {
    $('control-status').textContent = `Crash: ${error.message}`
  }
})
$('clock').addEventListener('click', async () => {
  try {
    const { row } = await post('/api/control/clock', { advance: '1h' })
    $('control-status').textContent = `Lab: ${row.body}.`
  } catch (error) {
    $('control-status').textContent = `Clock: ${error.message}`
  }
  await refreshState()
})
$('fault-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const fault = event.submitter.value
  const value = Number($(fault).value)
  try {
    await post('/api/control/fault', { [fault]: value })
    $('control-status').textContent =
      `Lab: ${switchSay(`${fault} = ${value}`)}.`
  } catch (error) {
    $('control-status').textContent = `Fault: ${error.message}`
  }
})
void poll()
