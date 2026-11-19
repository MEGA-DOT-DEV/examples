// The log of a run, turned into steps and into plain words. No DOM here: the page (page.js) draws
// what these functions return. Each step is a group of log lines; the state of a step is the
// state of the run after those lines.

export const stop = (text) => (/[.!?]["”]?$/.test(text) ? text : `${text}.`)
export const list = (items) =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
export const ticketsWord = (ids) =>
  `${ids.length === 1 ? 'ticket' : 'tickets'} ${list(ids.map(String))}`
/** "Every ticket goes to support." → "every ticket goes to support": a rule's own words inside a sentence. */
export const inline = (about) =>
  (about ?? '').replace(/\.$/, '').replace(/^[A-Z]/, (c) => c.toLowerCase())
export const where = (route) =>
  route ? `${route.queue}${route.urgent ? ', urgent' : ''}` : 'no answer'
export const same = (a, b) =>
  Boolean(a) && Boolean(b) && a.queue === b.queue && a.urgent === b.urgent

/** The check's own words for a problem, in plain words. */
export function plainProblem(problem) {
  if (!problem || /returned undefined|returned null/.test(problem)) {
    return 'gave no answer'
  }
  if (problem.startsWith('route threw')) {
    return 'stopped with an error'
  }
  return 'gave an answer that is not a queue'
}

/** The state of the run after the first `upto` lines of the log. */
export function replay(events, upto) {
  const st = {
    procs: [],
    rules: new Map(),
    active: null,
    routed: new Map(),
    tape: [],
    done: null,
    error: null,
    pending: null,
  }
  const rule = (v) =>
    st.rules.get(v) ??
    st.rules.set(v, { version: v, status: 'candidate' }).get(v)
  let proc = null
  events.slice(0, upto).forEach((e, index) => {
    const by = st.procs.find((p) => p.pid === e.pid) ?? proc
    const note = (text) => st.tape.push({ text, index, proc: by?.n ?? 0 })
    switch (e.kind) {
      case 'start':
        proc = {
          n: st.procs.length + 1,
          pid: e.child,
          exit: null,
          boot: null,
          exitIndex: null,
          loads: null,
        }
        st.procs.push(proc)
        break
      case 'exit': {
        const ended = st.procs.find((p) => p.pid === e.child)
        // A process that stops itself does so to load the rule that waits for its check.
        if (ended) {
          Object.assign(ended, { exit: e, exitIndex: index, loads: st.pending })
        }
        break
      }
      case 'boot':
        if (by) {
          by.boot = e
        }
        break
      case 'logic.proposed':
        Object.assign(rule(e.version), {
          source: e.source,
          why: e.why,
          base: st.active,
          status: 'candidate',
          about: /export const about = (["'])(.*?)\1/.exec(e.source ?? '')?.[2],
        })
        st.pending = e.version
        note(`v${e.version} written`)
        break
      case 'logic.trying':
        rule(e.version).status = 'checking'
        break
      case 'logic.accepted': {
        const replaced = st.active
        if (replaced !== null && replaced !== e.version) {
          rule(replaced).status = 'removed'
        }
        Object.assign(rule(e.version), {
          source: e.source,
          about: e.about,
          trial: e.trial,
          status: 'active',
          replaced,
        })
        st.active = e.version
        if (st.pending === e.version) {
          st.pending = null
        }
        note(
          replaced === null
            ? `rule v${e.version} in use`
            : `v${e.version} passed, in use`,
        )
        break
      }
      case 'logic.rejected':
        Object.assign(rule(e.version), {
          error: e.error,
          trial: e.trial,
          status: 'rejected',
        })
        if (st.pending === e.version) {
          st.pending = null
        }
        note(`v${e.version} rejected`)
        break
      case 'ticket':
        st.routed.set(e.ticket, { ...e, proc: by?.n ?? 0 })
        note(`ticket ${e.ticket} → ${where(e)}`)
        break
      case 'done':
        st.done = e
        note(e.status === 'done' ? 'job done' : `job ${e.status}`)
        break
      case 'error':
        st.error = e
        break
    }
  })
  return st
}

/** The steps of the run: each one is a group of log lines that a person sees as one thing. */
export function scenesOf(events) {
  const out = []
  let cur = null
  const open = (kind, i, extra) => {
    cur = { kind, from: i, end: i + 1, ...extra }
    out.push(cur)
  }
  const join = (i) => {
    if (cur) {
      cur.end = i + 1
    } else {
      open('start', i)
    }
  }
  events.forEach((e, i) => {
    switch (e.kind) {
      case 'start':
        if (!cur) {
          open('start', i)
        } else if (cur.kind === 'restart' && !cur.started) {
          Object.assign(cur, { end: i + 1, started: true })
        } else {
          open('restart', i, { started: true })
        }
        break
      case 'exit':
        if (e.code === 0 && cur?.kind === 'done') {
          join(i)
        } else if (e.code === 0) {
          open('done', i)
        } else {
          open('restart', i, { exit: e })
        }
        break
      case 'logic.trying':
        open('check', i, { version: e.version })
        break
      case 'logic.rejected':
      case 'logic.accepted':
        if (cur?.kind === 'check' && cur.version === e.version) {
          join(i)
        } else if (
          e.kind === 'logic.accepted' &&
          !events
            .slice(0, i)
            .some((p) => p.kind === 'logic.proposed' && p.version === e.version)
        ) {
          join(i) // the first rule: part of the start
        } else {
          open('check', i, { version: e.version })
        }
        if (cur.kind === 'check') {
          cur.verdict = e
        }
        break
      case 'logic.proposed':
        open('write', i, { version: e.version })
        break
      case 'ticket':
        open('ticket', i, { ticket: e.ticket })
        break
      case 'done':
        open('done', i)
        break
      case 'error':
        open('error', i, { message: e.message })
        break
      default:
        join(i)
    }
  })
  return out
}

/** True when a ticket got another answer than the rule before would give: the visible effect of a change. */
export function changedBy(st, t) {
  const before = st.rules
    .get(st.rules.get(t.version)?.replaced)
    ?.trial?.tickets?.find((o) => o.ticket === t.ticket)
  return before ? { was: before.route, changed: !same(before.route, t) } : null
}

/**
 * The words of two rule texts, as runs that are kept or changed. Only a common run of two words
 * or more counts as kept, so a lone "to" or "and" does not hide a change.
 */
export function textChange(before, after) {
  const words = (text) => text.match(/\S+\s*/g) ?? []
  const key = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const a = words(before)
  const b = words(after)
  const keptA = a.map(() => false)
  const keptB = b.map(() => false)
  /** Keep the longest common run inside a[a0, a1) and b[b0, b1), then look on its left and on its right. */
  const walk = ([a0, a1], [b0, b1]) => {
    let best = { len: 0, i: a0, j: b0 }
    for (let i = a0; i < a1; i++) {
      for (let j = b0; j < b1; j++) {
        let len = 0
        while (
          i + len < a1 &&
          j + len < b1 &&
          key(a[i + len]) === key(b[j + len])
        ) {
          len++
        }
        if (len > best.len) {
          best = { len, i, j }
        }
      }
    }
    if (best.len < 2) {
      return
    }
    for (let k = 0; k < best.len; k++) {
      keptA[best.i + k] = keptB[best.j + k] = true
    }
    walk([a0, best.i], [b0, best.j])
    walk([best.i + best.len, a1], [best.j + best.len, b1])
  }
  walk([0, a.length], [0, b.length])
  const runs = (list, kept) =>
    list.reduce((out, word, i) => {
      if (out.at(-1)?.kept === kept[i]) {
        out.at(-1).text += word
      } else {
        out.push({ text: word, kept: kept[i] })
      }
      return out
    }, [])
  return { was: runs(a, keptA), now: runs(b, keptB) }
}

/** True when the agent did what the owner asked: a rule that it wrote is in use. */
export const ownerDone = (st) =>
  [...st.rules.values()].some(
    (r) => r.status === 'active' && r.replaced !== null,
  )

/** Where a new process goes on: the first thing that the log does not call done. `item` is its place in the inbox, if it has one. */
export function resumePoint(st, inbox) {
  const owner = inbox.find((item) => item.from === 'owner')
  if (st.pending !== null) {
    const waits = st.rules.get(st.pending).status !== 'checking'
    return {
      item: owner?.id ?? null,
      text: waits
        ? `the check of the new rule v${st.pending}`
        : `the new rule v${st.pending}: its check did not finish, so it is rejected`,
    }
  }
  for (const item of inbox) {
    if (item.from === 'customer' && !st.routed.has(item.id)) {
      return { item: item.id, text: `ticket ${item.id}` }
    }
    if (item.from === 'owner' && !ownerDone(st)) {
      return { item: item.id, text: 'the request of the owner' }
    }
  }
  return { item: null, text: 'the last report' }
}

/** What a new process learns from the log, as short facts, and where it goes on. */
export function knownFromLog(st) {
  const facts = []
  const done = [...st.routed.keys()]
  facts.push(
    done.length
      ? `${ticketsWord(done)} ${done.length === 1 ? 'is' : 'are'} done`
      : 'no ticket is done yet',
  )
  if (st.active !== null) {
    facts.push(`rule v${st.active} is in use`)
  }
  if (st.pending !== null) {
    facts.push(
      st.rules.get(st.pending).status === 'checking'
        ? `the check of v${st.pending} did not finish`
        : `v${st.pending} waits for its check`,
    )
  }
  return facts
}

/** How a process ended, in plain words: one word, what it did last (`did`), and a full sentence. `loads` is the rule it stopped for. */
export function ending(exit, loads = null) {
  if (!exit) {
    return null
  }
  if (exit.signal === 'SIGKILL') {
    return {
      word: 'killed',
      did: 'was killed',
      long: 'It was killed from outside (SIGKILL).',
    }
  }
  if (exit.code === 75) {
    return {
      word: 'stopped',
      did:
        loads === null
          ? 'stopped itself to restart'
          : `stopped itself to load v${loads}`,
      long: 'It ended itself with exit code 75. That code means "restart me".',
    }
  }
  if (exit.code === 0) {
    return {
      word: 'finished',
      did: 'finished',
      long: 'It ended with exit code 0: the job is done.',
    }
  }
  return {
    word: 'crashed',
    did: 'crashed',
    long: `It crashed (${exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`}).`,
  }
}

/** Everything the page says about one step: its short name, its tone, and the caption. */
export function tell(scene, st, fin) {
  const proc = st.procs.at(-1)
  const active = st.rules.get(st.active)
  switch (scene.kind) {
    case 'start': {
      if (!active) {
        return {
          label: 'Start',
          say: 'The agent starts.',
          why: 'It loads its first rule.',
        }
      }
      return {
        label: 'Start',
        say: `The agent starts with rule v${active.version}: ${inline(active.about)}.`,
        why: 'The rule is a small part inside the agent. It decides where each ticket goes, and it is the only part the agent can replace.',
      }
    }
    case 'ticket': {
      const t = st.routed.get(scene.ticket)
      const label = `Ticket ${scene.ticket}`
      const went = `Ticket ${t.ticket} goes to ${t.queue}${t.urgent ? ', as urgent' : ''}.`
      const effect = changedBy(st, t)
      const resumed =
        [...st.routed.values()].filter((o) => o.proc === t.proc).length === 1 &&
        st.routed.size > 1
      const earlier = [...st.routed.keys()].filter((id) => id !== t.ticket)
      const goesOn = resumed
        ? ` Process ${t.proc} went on here, because the log says ${ticketsWord(earlier)} ${earlier.length === 1 ? 'is' : 'are'} done.`
        : ''
      if (effect?.changed) {
        return {
          label,
          tone: 'good',
          say: `${went} The new rule changed this.`,
          why: `The old rule v${st.rules.get(t.version).replaced} would send it to ${where(effect.was)}.${goesOn}`,
        }
      }
      if (effect) {
        return {
          label,
          say: `${went} The new rule did not change this.`,
          why: `Rule v${st.rules.get(t.version).replaced} and rule v${t.version} give the same answer for this ticket.${goesOn}`,
        }
      }
      // Before any change. With the whole run in the log, the page can say what the later rule would do.
      const later = fin.rules.get(fin.active)
      const then =
        later && later.version !== t.version
          ? later.trial?.tickets?.find((o) => o.ticket === t.ticket)
          : null
      if (then && !same(then.route, t)) {
        return {
          label,
          say: `${went} Rule v${t.version} decided it.`,
          why: `Remember this ticket. The later rule v${later.version} would send it to ${where(then.route)}. But it is done now, and a done ticket stays done.`,
        }
      }
      return {
        label,
        say: `${went} Rule v${t.version} decided it.`,
        why: `The agent takes one ticket at a time and asks its rule. Then it writes the result in the log on disk.${goesOn}`,
      }
    }
    case 'write': {
      const v = scene.version
      const failed = [...st.rules.values()].findLast(
        (r) => r.status === 'rejected' && r.version < v,
      )
      if (failed) {
        return {
          label: `Write v${v}`,
          say: `The agent changes itself again: it reads why v${failed.version} failed and writes a fix, rule v${v}.`,
          why: `Rule v${v} is again only a candidate. The agent restarts to check it.`,
        }
      }
      return {
        label: `Write v${v}`,
        say: `The agent changes itself: the owner asks for a new rule, and the agent writes it as rule v${v}.`,
        why: `Nobody else writes it. Rule v${v} is only a candidate: a new rule can be wrong, so it must pass a check before the agent uses it.`,
      }
    }
    case 'restart': {
      const old = st.procs.at(scene.started ? -2 : -1)
      const end = ending(old?.exit)
      const facts = knownFromLog(st)
      const planned = end?.word === 'stopped'
      const label =
        { stopped: 'Restart', killed: 'Killed', crashed: 'Crashed' }[
          end?.word
        ] ?? 'Restart'
      const tone = end && !planned ? 'bad' : undefined
      // A restart on purpose always follows a new rule: the agent ends itself to load it.
      const lost = planned
        ? `To load the new rule, the agent restarts: process ${old.n} stops`
        : `Process ${old?.n} ${end?.word === 'killed' ? 'was killed' : 'crashed'}`
      if (!scene.started) {
        return {
          label,
          tone,
          say: `${lost}. A new process starts in a moment.`,
          why: 'A process forgets everything when it ends. Only the log on disk stays.',
        }
      }
      if (!old) {
        return {
          label,
          say: `Process ${proc.n} starts.`,
          why: `It reads the log on disk: ${list(facts)}.`,
        }
      }
      return {
        label,
        tone,
        say: planned
          ? `${lost}, process ${proc.n} starts.`
          : `${lost}. The supervisor, a small program that watches the agent, starts process ${proc.n}.`,
        why: `Process ${proc.n} reads the log on disk: ${list(facts)}. So it does not start the job again.`,
      }
    }
    case 'check': {
      const v = scene.version
      const r = st.rules.get(v)
      if (!scene.verdict) {
        return {
          label: `Check v${v}`,
          say: `Process ${proc?.n} checks rule v${v} before it uses it.`,
          why: 'The check tries the new rule on sample tickets. Each one must get a valid answer.',
        }
      }
      if (r.status === 'rejected') {
        const bad = r.trial?.samples?.find((o) => !o.route)
        const count = r.trial?.samples?.length
        return {
          label: `v${v} fails`,
          tone: 'bad',
          say: bad
            ? `Rule v${v} fails its check: it ${plainProblem(bad.problem)} for “${bad.text}”`
            : stop(`Rule v${v} is rejected: ${r.error}`),
          why: `${count ? `The check tries a new rule on ${count} sample tickets. ` : ''}Rule v${v} is rejected and never touches a real ticket. Rule v${st.active} stays in use.`,
        }
      }
      return {
        label: `v${v} passes`,
        tone: 'good',
        say: `Rule v${v} passes its check. The agent now works with the rule it wrote: v${v} is in, v${r.replaced} is out.`,
        why: `From now on: ${inline(r.about)}. Tickets that are done stay as they are.`,
      }
    }
    case 'done': {
      if (st.done && st.done.status !== 'done') {
        return {
          label: 'Ended',
          tone: 'bad',
          say: `The run ended: ${stop(st.done.reason ?? st.done.status)}`,
          why: 'The job did not finish.',
        }
      }
      const rejected = [...st.rules.values()].filter(
        (r) => r.status === 'rejected',
      )
      const first = [...st.rules.values()].find((r) => r.replaced === null)
      const parts = []
      if (active && first && active.version !== first.version) {
        parts.push(
          `The agent changed its own rule (v${first.version} → v${active.version})`,
        )
      }
      if (rejected.length) {
        parts.push(
          `the check stopped ${plural(rejected.length, 'bad version', 'bad versions')} (${list(rejected.map((r) => `v${r.version}`))})`,
        )
      }
      if (st.procs.length > 1) {
        parts.push(
          `${plural(st.procs.length - 1, 'restart', 'restarts')} lost nothing`,
        )
      }
      const sum = parts.length ? `${list(parts)}.` : ''
      return {
        label: 'Done',
        say: `The job is done: ${plural(st.routed.size, 'ticket is', 'tickets are')} routed, each one exactly once.`,
        why: sum.charAt(0).toUpperCase() + sum.slice(1),
      }
    }
    default:
      return {
        label: 'Error',
        tone: 'bad',
        say: stop(`Problem: ${scene.message}`),
        why: 'The supervisor wrote this problem into the log.',
      }
  }
}

/** "v2 gave no answer for “I cannot log in.”": the first sample ticket a version failed on. */
export function sampleFail(r) {
  const bad = r.trial?.samples?.find((o) => !o.route)
  return bad
    ? `v${r.version} ${plainProblem(bad.problem)} for “${bad.text}”`
    : null
}

/** True when the run is over: the job is done, or the supervisor gave up. */
export const finished = (events) =>
  events.some(
    (e) =>
      (e.kind === 'exit' && e.code === 0) ||
      (e.kind === 'error' && e.by === 'supervisor'),
  )
