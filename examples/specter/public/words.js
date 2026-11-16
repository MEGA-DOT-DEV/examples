// The log in words: each row as the plain sentence the page shows. No page
// state and no DOM: `app.js` renders them.

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
function span(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
/** A duration in its largest whole unit: 24 h, 5 min, 30 s. */
function duration(ms) {
  if (ms % 3_600_000 === 0) {
    return `${ms / 3_600_000} h`
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000} min`
  }
  return `${Math.round(ms / 1000)} s`
}
/** A short gap in words: a restart is often faster than a second. */
const gap = (ms) =>
  ms < 1000 ? 'less than a second' : count(Math.round(ms / 1000), 'second')
function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
/**
 * An address or an author in words. The user reaches Specter by email, by a
 * message to pull from (mcp), and by edits of their notes (git).
 */
function nameOf(address) {
  if (['email:adam', 'mcp:adam', 'git', 'adam'].includes(address)) {
    return 'the user'
  }
  if (address === 'instance:specter') {
    return 'Specter'
  }
  if (address === 'instance:researcher') {
    return 'the researcher'
  }
  if (address === 'harness') {
    return 'host code'
  }
  if (address === 'clock') {
    return 'the clock'
  }
  if (address === '*') {
    return 'every instance'
  }
  return address?.startsWith('instance:') ? address.slice(9) : (address ?? '—')
}
/** The cost of a run or a first look in dollars, or nothing when it is 0. */
const costSay = (cost) => (cost > 0 ? `$${cost.toFixed(4)}` : '')
/** What a first look decided, in words. */
const LOOKS = {
  wake: 'wakes Specter for a full run',
  keep: 'keeps them for Specter’s next run',
  ignore: 'leaves them out: no run reads them',
}
/**
 * A `time` row in words: key `time:agenda:<slug>:<at>` and body `agenda
 * "<title>" is due. Why: … Next: …`, or `time:heartbeat:<at>`.
 */
function timeSay(row) {
  if (row.key?.startsWith('time:heartbeat:')) {
    return {
      head: 'Heartbeat: no other wake came, so the safety net wakes Specter',
      text: row.body,
    }
  }
  const title = /^agenda "(.*)" is due\. /.exec(row.body)?.[1]
  if (!title) {
    return { head: `${capital(nameOf(row.to))} wakes on time`, text: row.body }
  }
  return {
    head: `Specter’s agenda: “${title}” is due`,
    text: row.body.slice(row.body.indexOf(' is due. ') + 9),
  }
}
/** An edit row's change, as the verb of a sentence about the user. */
const CHANGES = { added: 'adds', edited: 'edits', deleted: 'deletes' }
/** An inbound row in words: a heading, its text, and lines to show under it. */
function eventSay(row) {
  if (row.kind === 'time') {
    return timeSay(row)
  }
  if (row.kind === 'look') {
    const {
      decision = 'keep',
      reason = row.body,
      rows = [],
    } = parse(row.result) ?? {}
    return {
      head: `First look at ${count(rows.length, 'event')}: ${decision}`,
      text: `It ${LOOKS[decision] ?? decision}. Why: ${reason}`,
    }
  }
  if (row.kind === 'outcome') {
    const { signal = 'outcome' } = parse(row.result) ?? {}
    return {
      head: `Feedback on Specter’s work: ${signal}`,
      text: row.body
        .replace(/\binstance:specter\b/g, 'Specter')
        .replace(/\binstance:(\S+)/g, '$1'),
    }
  }
  if (row.kind === 'edit') {
    const match = /^(\S+) (added|edited|deleted): (.*)$/s.exec(row.body)
    if (!match) {
      return { head: 'The user changes a note', text: row.body }
    }
    const [, path, change, summary] = match
    return { head: `The user ${CHANGES[change]} ${path}`, text: summary }
  }
  if (row.from === 'email:adam') {
    return { head: `The user emails ${nameOf(row.to)}`, text: row.body }
  }
  if (row.from === 'mcp:adam') {
    return {
      head: `The user writes to ${nameOf(row.to)} (mcp)`,
      text: row.body,
    }
  }
  return {
    head: `${capital(nameOf(row.from))} writes to ${nameOf(row.to)}`,
    text: row.body,
  }
}
/** The lines an edit or an edited output added, as the log row carries them. */
function addedLines(row) {
  const added = parse(row.result)?.added
  return Array.isArray(added)
    ? added.slice(0, 4).map((line) => `+ ${line}`)
    : []
}
/**
 * Host tool results in words. Each pattern matches the journal row of one tool.
 */
const RESULTS = [
  [/^read \/$/, () => 'Lists the workspace.'],
  [
    /^read journal\.jsonl$/,
    () => 'Reads its journal: what every instance and host code did.',
  ],
  [
    /^read (.+) \(lines with "(.*)"\)$/,
    (path, query) => `Reads the lines of ${path} that contain “${query}”.`,
  ],
  [/^read (.+)$/, (path) => `Reads ${path}.`],
  [
    /^fetched (\S+) \(redirected from (\S+)\) as fetch \d+$/,
    (url, from) => `Fetches ${from}, which redirects to ${url}.`,
  ],
  [/^fetched (\S+) as fetch \d+$/, (url) => `Fetches ${url}.`],
  [
    /^quoted fetch \d+ \((\S+)\) into (\S+)$/,
    (url, path) =>
      `Saves an exact quote from ${url} as a checked source, ${path}.`,
  ],
  [
    /^wrote documents\/agenda\.md v(\d+)$/,
    (version) =>
      `Changes its own agenda: documents/agenda.md, version ${version}.`,
  ],
  [
    /^wrote (\S+) v(\d+)$/,
    (path, version) => `Writes ${path}, version ${version}.`,
  ],
]
/**
 * Host refusals in words. Each pattern matches one reason that host code writes
 * (`src/web.ts`, `src/tools.ts`, `src/tick.ts`, `src/inbound.ts`).
 */
const REFUSALS = [
  [
    /^web_fetch refused: untrusted or invalid URL (\S+)/,
    (url) =>
      `Host code refuses to fetch ${url}: the site is not on the trusted list in config.yaml.`,
  ],
  [
    /^web_fetch refused: redirect to untrusted or invalid URL (\S+)/,
    (url) =>
      `Host code refuses the redirect to ${url}: that site is not on the trusted list in config.yaml.`,
  ],
  [
    /^web_fetch refused: redirect loop at (\S+)/,
    (url) =>
      `Host code ends the fetch at ${url}: its redirects go round in a loop.`,
  ],
  [
    /^web_fetch refused: no synthetic page for (\S+)/,
    (url) =>
      `Host code refuses to fetch ${url}: the lab’s offline web has no such page.`,
  ],
  [
    /^web_fetch refused: URL was not sent or saved by the user, or linked from a fetched page: (\S+)/,
    (url) =>
      `Host code refuses to fetch ${url}: the user did not send or save it, and no page fetched in this run links to it.`,
  ],
  [
    /^source_quote refused/,
    () =>
      'Host code refuses the quote: it is not an exact passage of a page fetched in this run.',
  ],
  [
    /^Specter is paused \(config\.yaml paused: true\)/,
    () =>
      'Host code holds the message back: config.yaml pauses Specter, so nothing is sent.',
  ],
  [
    /^the (email|mcp) channel is off in config\.yaml/,
    (channel) =>
      `Host code holds the message back: the user switched the ${channel} channel off in config.yaml.`,
  ],
  [
    /^a message to the user needs why_now/,
    () =>
      'Host code refuses the message: it gives no why_now, one sentence on why it cannot wait for the digest or a later run.',
  ],
  [
    /^it is quiet hours \(([^)]*)\)/,
    (hours) =>
      `Host code holds the email back: it is quiet hours (${hours}), so no email reaches the user now.`,
  ],
  [
    /^(\d+) emails reached the user in the last 7 days; the weekly budget is (\d+)/,
    (sent, budget) =>
      `Host code refuses the email: ${sent} emails reached the user this week, and the weekly budget is ${budget} (config.yaml).`,
  ],
  [
    /^The user deleted (\S+) \(v(\d+), [^)]*\): a deleted output stays deleted/,
    (path) =>
      `Host code refuses to write ${path}: the user deleted it, and a deleted output stays deleted.`,
  ],
  [
    /^config\.yaml paused Specter: run (\S+) is aborted/,
    (run) =>
      `config.yaml pauses Specter: host code aborts run ${run}, and no wake starts until the pause is off.`,
  ],
  [
    /^the (\S+) source is off in config\.yaml: an event from (\S+) is not recorded/,
    (source, from) =>
      `Host code drops an event from ${nameOf(from)}: the ${source} source is off in config.yaml.`,
  ],
  [
    /^(\S+): the knowledge_base source is off in config\.yaml/,
    (path) =>
      `Host code refuses to read ${path}: the knowledge_base source is off in config.yaml.`,
  ],
  [
    /^documents\/agenda\.md: item "(.*)" sets no wake: (.*)$/,
    (title, reason) =>
      `Host code sets no wake for the agenda item “${title}”: ${reason}.`,
  ],
  [
    /^only email:adam/,
    () =>
      'Host code refuses the email: only the user may receive email from Specter.',
  ],
  [
    /^the body is (\d+) bytes; an email holds at most (\d+)/,
    (size, limit) =>
      `Host code refuses the email: it is ${size} bytes, and config.yaml allows at most ${limit}.`,
  ],
  [
    /emails were sent today; the limit is (\d+) per day/,
    (limit) =>
      `Host code refuses the email: Specter may email the user at most ${limit} times a day (config.yaml).`,
  ],
  [
    /^config\.yaml belongs to the user/,
    () => 'Host code refuses to write config.yaml: only the user changes it.',
  ],
  [
    /^(\S+) is a read-only view/,
    (path) =>
      `Host code refuses to write ${path}: it is a read-only view of the log.`,
  ],
  [
    /^(\S+) is outside the write paths/,
    (path) =>
      `Host code refuses to write ${path}: it is outside the paths Specter may write (config.yaml).`,
  ],
  [
    /^only source_quote writes documents\/sources\//,
    () =>
      'Host code refuses the write: only a checked quote may add a source document.',
  ],
  [
    /^a role document is /,
    () =>
      'Host code refuses the write: a role document must sit at documents/instances/<name>.md.',
  ],
  [
    /^(\S+) is the role document of another instance/,
    (path) =>
      `Host code refuses to write ${path}: it is another instance’s role document.`,
  ],
  [
    /^version (\d+) of (\S+) is stale: the newest is v(\d+) by (\S+);/,
    (read, path, newest, author) =>
      `Host code refuses to write ${path}: the run read version ${read}, but ${nameOf(author)} wrote version ${newest} since. The run must read it again.`,
  ],
  [
    /^(\S+) has no version (\d+)/,
    (path, version) =>
      `Host code refuses to write ${path}: the file has no version ${version}.`,
  ],
  [
    /^(.+) is not a workspace path/,
    (path) =>
      `Host code refuses ${path}: it is not a path inside the workspace.`,
  ],
  [
    /^(\S+) is not an address/,
    (to) => `Host code refuses the message: ${to} is not an address.`,
  ],
  [
    /^no instance (\S+?):/,
    (name) =>
      `Host code refuses the message: there is no instance called ${name}.`,
  ],
  [
    /^level must be one of/,
    () =>
      'Host code refuses the decision: its level is not on the ladder (nothing, record, note, digest, message).',
  ],
  [
    /^a decision needs its reason/,
    () => 'Host code refuses the decision: it gives no reason.',
  ],
  [
    /^wakes_per_cause: .* the limit is (\d+)/,
    (limit) =>
      `Host code refuses another wake: one cause may wake Specter at most ${limit} times (config.yaml).`,
  ],
  [
    /^wakes_per_day: .* the limit is (\d+)/,
    (limit) =>
      `Host code refuses another wake: Specter may wake at most ${limit} times a day (config.yaml).`,
  ],
]
/**
 * What a refused row held back, from its key: `fetch:`, `quote:`, `write:`,
 * `send:`, `read:`, `decide:`, `revert:`, or `refused:<what>:`.
 */
function refusalSay(row) {
  const nouns = {
    fetch: 'the fetch',
    quote: 'the quote',
    write: 'the write',
    send: 'the message',
    read: 'the read',
    decide: 'the decision',
    revert: 'the revert',
    refused: 'another wake',
  }
  const noun = nouns[row.key?.split(':')[0]] ?? 'this step'
  return sayFirst(
    REFUSALS,
    row.body,
    `Host code refuses ${noun}: ${row.body.replace(/^\w+ refused:\s*/, '')}.`,
  )
}
/**
 * Why a run failed, in words. `aborted` is the pause in config.yaml; the rest
 * are pi's reasons, kept in the log details.
 */
function failureSay(reason) {
  if (reason === 'aborted') {
    return 'config.yaml paused Specter, so the run was aborted'
  }
  if (reason === 'model_error') {
    return 'the model kept failing, so the run gave up after its retries'
  }
  if (reason === 'unanswered') {
    return 'it ended with no answer'
  }
  return reason.startsWith('start failed') ? 'it could not start' : reason
}
/** The words of the first pattern that matches `text`, or the fallback. */
function sayFirst(patterns, text, fallback) {
  for (const [pattern, words] of patterns) {
    const match = pattern.exec(text)
    if (match) {
      return words(...match.slice(1))
    }
  }
  return fallback
}
/** "the next request", or "the next 3 requests". */
const theNext = (n, word) =>
  n === 1 ? `the next ${word}` : `the next ${n} ${word}s`
/** The fault switches in words, for the lab rows and the switch form. */
const SWITCHES = {
  model_errors: (n) =>
    n > 0
      ? `the lab fails ${theNext(n, 'model request')}`
      : 'model requests work again',
  before_deliver_ms: (ms) =>
    ms > 0
      ? `an email waits ${ms / 1000} s before it is sent`
      : 'no pause before an email',
  after_deliver_ms: (ms) =>
    ms > 0
      ? `an email waits ${ms / 1000} s between sending and its receipt`
      : 'no pause after an email',
  forget_why_now: (n) =>
    n > 0
      ? `the lab brain leaves why_now out of ${theNext(n, 'message')} to the user`
      : 'the lab brain gives why_now with every message to the user',
}
function switchSay(setting) {
  const [name, value] = setting.split(' = ')
  return SWITCHES[name]?.(Number(value)) ?? setting
}
function deliverySay(row) {
  const { attempts = 1, resumed = false } = parse(row.result) ?? {}
  if (attempts > 1) {
    return {
      text: `Email delivered after the restart. The user’s outbox saw ${attempts} attempts with one receipt key and kept one email. Receipt written.`,
      tone: 'email',
    }
  }
  if (resumed) {
    return {
      text: 'Email delivered after the restart, once: the first attempt ended before sending. Receipt written.',
      tone: 'email',
    }
  }
  return {
    text: 'Email delivered to the user. Receipt written.',
    tone: 'email',
  }
}
function revertSay(row) {
  const done = parse(row.result)
  if (!done) {
    return { text: `${capital(nameOf(row.from))}: ${row.body}.`, tone: 'host' }
  }
  const users = done.kept.filter((entry) => entry.includes(' by adam '))
  const others = done.kept.length - users.length
  const parts = [`${capital(nameOf(row.from))} reverts its run ${done.run}.`]
  if (done.reverted.length) {
    parts.push(
      `Host code puts back ${count(done.reverted.length, 'file')} that run wrote.`,
    )
  }
  if (users.length) {
    parts.push(
      `The user’s later edit of ${users.map((entry) => entry.split(' (')[0]).join(', ')} stays: a revert never erases their edits.`,
    )
  }
  if (others) {
    parts.push(
      `It keeps ${count(others, 'file')} with a newer version from a later run.`,
    )
  }
  if (done.emails) {
    parts.push(`${count(done.emails, 'email')} it sent cannot be unsent.`)
  }
  return { text: parts.join(' '), tone: 'host' }
}
function faultSay(row) {
  if (row.body.startsWith('lab crash')) {
    return { text: 'The lab kills the node here.', tone: 'crash' }
  }
  if (row.body.startsWith('model_errors:')) {
    return {
      text: 'A model request fails on purpose, a lab fault. The caller waits and retries.',
      tone: 'lab',
    }
  }
  if (row.body.startsWith('forget_why_now:')) {
    return {
      text: 'The lab brain leaves why_now out of a message to the user on purpose, a lab fault.',
      tone: 'lab',
    }
  }
  return {
    text: `Lab: ${row.body.replace(/^set /, '').split(', ').map(switchSay).join('; ')}.`,
    tone: 'lab',
  }
}
/** The why_now of a message or an email intent to the user. */
const whyNowOf = (row) => parse(row.result)?.why_now
/**
 * Each switch: its label, where it sits in `GET /api/state`, and the nested
 * change that sets it.
 */
const SWITCH_LIST = [
  {
    id: 'paused',
    label: 'Pause Specter',
    read: (state) => state.paused,
    change: (on) => ({ paused: on }),
    on: 'paused: no wake, nothing sent',
    off: 'running',
  },
  {
    id: 'knowledge_base',
    label: 'Knowledge base source',
    read: (state) => state.switches.sources.knowledge_base,
    change: (on) => ({ sources: { knowledge_base: on } }),
    on: 'on: your note edits reach Specter',
    off: 'off: your note edits are not recorded',
  },
  {
    id: 'messages',
    label: 'Messages source',
    read: (state) => state.switches.sources.messages,
    change: (on) => ({ sources: { messages: on } }),
    on: 'on: your messages reach Specter',
    off: 'off: your messages are not recorded',
  },
  {
    id: 'email',
    label: 'Email channel',
    read: (state) => state.switches.channels.email,
    change: (on) => ({ channels: { email: on } }),
    on: 'on: Specter may email you',
    off: 'off: no email reaches you',
  },
  {
    id: 'mcp',
    label: 'MCP channel',
    read: (state) => state.switches.channels.mcp,
    change: (on) => ({ channels: { mcp: on } }),
    on: 'on: Specter may leave you messages to pull',
    off: 'off: no message waits for you',
  },
]

export {
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
}
