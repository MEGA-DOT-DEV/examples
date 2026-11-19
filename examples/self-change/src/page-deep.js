// Levels 2 and 3 of the page: why the step on the picture works like this, and its code and log lines.
import { chips, h } from './page-dom.js'
import { excerpt, POINTS } from './page-source.js'
import {
  changedBy,
  ending,
  inline,
  list,
  plainProblem,
  plural,
  same,
  stop,
  ticketsWord,
  where,
} from './page-steps.js'

const qa = (question, ...body) =>
  h(
    'section',
    { class: 'qa' },
    h('h3', {}, question),
    body.flat().map((b) => (typeof b === 'string' ? h('p', {}, b) : b)),
  )

/** What two versions do with every customer ticket of the inbox, from the dry run of each check. */
function compareTable(before, after) {
  const rows = (after.trial?.tickets ?? []).map((o) => {
    const was = before.trial?.tickets?.find((b) => b.ticket === o.ticket)
    return h(
      'tr',
      { class: was && !same(was.route, o.route) ? 'changed' : undefined },
      h('td', { class: 'n' }, String(o.ticket)),
      h('td', {}, o.text),
      h('td', {}, was ? chips(was.route) : '—'),
      h('td', {}, chips(o.route)),
    )
  })
  return h(
    'div',
    { class: 'tablebox' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, '#'),
          h('th', {}, 'Ticket'),
          h('th', {}, `v${before.version}`),
          h('th', {}, `v${after.version}`),
        ),
      ),
      h('tbody', {}, rows),
    ),
  )
}

export function whyBlocks(scene, st, fin) {
  const active = st.rules.get(st.active)
  switch (scene.kind) {
    case 'start':
      return [
        qa(
          'What is the rule?',
          'A small function. It gets one ticket and answers two things: the queue (support or billing), and urgent or not.',
        ),
        qa(
          'Why is it a separate part?',
          'So the agent can replace it. The rule is the only part the agent may change. The check, the log and the restart are fixed code.',
        ),
        qa(
          'What will happen in this run?',
          'One item in the inbox is not a ticket. It is a request from the owner for another rule. Watch how the agent changes its rule and still finishes the job.',
        ),
      ]
    case 'ticket': {
      const t = st.routed.get(scene.ticket)
      const effect = changedBy(st, t)
      const later = fin.rules.get(fin.active)
      const then =
        later && later.version !== t.version
          ? later.trial?.tickets?.find((o) => o.ticket === t.ticket)
          : null
      return [
        effect?.changed
          ? qa(
              'Why did the answer change?',
              `The old rule v${st.rules.get(t.version).replaced} gave: ${where(effect.was)}. Rule v${t.version} gives: ${where(t)}. The agent wrote rule v${t.version} after the request of the owner, and it passed the check.`,
            )
          : null,
        effect && !effect.changed
          ? qa(
              'Why is the answer the same?',
              `Rule v${t.version} changes only some tickets. For this one it gives the same answer as rule v${st.rules.get(t.version).replaced}: ${where(t)}.`,
            )
          : null,
        then && !same(then.route, t)
          ? qa(
              'Does the later rule change this ticket?',
              `No. Rule v${later.version} would send it to ${where(then.route)}. But this ticket was done before the change, and a done ticket stays done. A new rule applies only to the tickets after it.`,
            )
          : null,
        qa(
          'Who decides the queue?',
          'The rule. The agent does not think about the ticket: it passes the ticket to the rule and takes the answer. So the same ticket always gets the same answer.',
        ),
        qa(
          'Why does the agent write it in the log?',
          `The line “ticket ${t.ticket} → ${where(t)}” is a receipt. If the process ends and a new one starts, it finds the receipt and does not route the ticket again.`,
        ),
      ]
    }
    case 'write': {
      const v = scene.version
      const failed = [...st.rules.values()].findLast(
        (r) => r.status === 'rejected' && r.version < v,
      )
      return [
        failed
          ? qa(
              'How did the agent know what to fix?',
              'The result of the check went back to the agent, word for word:',
              h(
                'p',
                { class: 'quote' },
                `v${failed.version} rejected: ${failed.error}`,
              ),
              `The agent read it and wrote rule v${v}.`,
            )
          : qa(
              `Who wrote rule v${v}?`,
              'The agent. The owner only said what the rule must do, in plain words. The agent turned that into code.',
            ),
        qa(
          `Why is rule v${v} not used at once?`,
          'A new rule can be wrong. So it is a candidate first. The agent uses it only after it passes the check.',
        ),
        qa(
          'Why does the agent restart now?',
          'A running process keeps its old rule. A new process loads the new file from disk and checks it before it does anything else.',
        ),
      ]
    }
    case 'restart': {
      const old = st.procs.at(scene.started ? -2 : -1)
      const end = ending(old?.exit)
      return [
        qa(
          'What is lost?',
          `Everything in the memory of process ${old?.n ?? '?'}. ${end?.long ?? ''}`,
        ),
        qa(
          'What stays?',
          'Two things on disk: the log, with one line per finished step, and the saved conversation of the agent. The new process opens both and continues from the last saved step.',
        ),
        qa(
          'Who starts the new process?',
          'The supervisor: a second, very small program that never changes. Each time the agent ends before the job is done, the supervisor starts it again.',
        ),
        qa(
          'Is a restart different from a crash?',
          'No. A restart on purpose and a crash take the same path: a new process, and the log. Try it: click Run again, then Kill the agent at any moment.',
        ),
      ]
    }
    case 'check': {
      const r = st.rules.get(scene.version)
      const samples = r.trial?.samples ?? []
      if (!scene.verdict) {
        return [
          qa(
            'What is the check?',
            'Fixed code that the agent cannot change. It tries the new rule on sample tickets. Each ticket must get a valid answer: a queue, and urgent or not.',
          ),
        ]
      }
      if (r.status === 'rejected') {
        const failedSamples = samples.filter((o) => !o.route)
        const noQueue = (r.trial?.tickets ?? [])
          .filter((o) => !o.route)
          .map((o) => o.ticket)
        return [
          qa(
            'What is the check?',
            `Fixed code that the agent cannot change. It tries the new rule on ${samples.length || 'some'} sample tickets. Each ticket must get a valid answer: a queue, and urgent or not.`,
          ),
          samples.length
            ? qa(
                `What went wrong in rule v${r.version}?`,
                `It answered ${samples.length - failedSamples.length} of ${samples.length} sample tickets. For ${list(failedSamples.map((o) => `“${o.text}”`))} it ${plainProblem(failedSamples[0]?.problem)}.`,
              )
            : qa(`What went wrong in rule v${r.version}?`, stop(r.error)),
          noQueue.length
            ? qa(
                'What if there was no check?',
                `Rule v${r.version} would be in use now. ${ticketsWord(noQueue).replace(/^t/, 'T')} of the inbox would get no queue. The check stopped the rule before it touched a real ticket.`,
              )
            : null,
          qa(
            'What happens now?',
            `Rule v${st.active} stays in use. The agent gets the reason of the failure and can try again.`,
          ),
        ]
      }
      const before = st.rules.get(r.replaced)
      const missed = [...st.routed.values()]
        .filter(
          (t) =>
            !same(
              r.trial?.tickets?.find((o) => o.ticket === t.ticket)?.route ?? t,
              t,
            ),
        )
        .map((t) => t.ticket)
      return [
        before
          ? qa(
              'What does the new rule change?',
              'Each rule was tried on every ticket of the inbox. Green rows get another answer.',
              compareTable(before, r),
            )
          : null,
        qa(
          `Why can the agent trust rule v${r.version}?`,
          `It passed the check: all ${samples.length || ''} sample tickets got a valid answer.`,
        ),
        missed.length
          ? qa(
              'What about the done tickets?',
              `${ticketsWord(missed).replace(/^t/, 'T')} ${missed.length === 1 ? 'was' : 'were'} routed by the old rule, before the change. ${missed.length === 1 ? 'It stays where it is' : 'They stay where they are'}. A new rule applies only to the tickets after it.`,
            )
          : null,
      ]
    }
    case 'done': {
      const kills = st.procs.filter((p) => p.exit?.signal === 'SIGKILL').length
      return [
        qa(
          'What did you see?',
          h(
            'ol',
            {},
            h(
              'li',
              {},
              'A rule inside the agent decides where each ticket goes.',
            ),
            h(
              'li',
              {},
              'The agent replaced its own rule, because the owner asked.',
            ),
            h(
              'li',
              {},
              'A check stopped a bad version before it touched a real ticket.',
            ),
            h(
              'li',
              {},
              `The process ended ${plural(st.procs.length - 1, 'time', 'times')}${kills ? ` (${kills} by a kill)` : ''}. The log on disk kept the job, and no ticket was routed twice.`,
            ),
          ),
        ),
        qa(
          'Try it',
          'Click Run again, then click Kill the agent at any moment. The run still ends with every ticket routed once.',
        ),
        active
          ? qa(
              'What does the agent do from now on?',
              `It keeps rule v${active.version}: ${inline(active.about)}.`,
            )
          : null,
      ]
    }
    default:
      return [qa('What happened?', stop(scene.message ?? 'A problem.'))]
  }
}

const linesOf = (source) => (source ?? '').replace(/\n$/, '').split('\n')

/** A line diff (longest common subsequence). The files are a few lines long. */
function diff(a, b) {
  const x = linesOf(a),
    y = linesOf(b)
  const n = x.length,
    m = y.length
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] =
        x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    }
  }
  const out = []
  let i = 0,
    j = 0
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      out.push([' ', x[i]])
      i++
      j++
    } else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) {
      out.push(['-', x[i]])
      i++
    } else {
      out.push(['+', y[j]])
      j++
    }
  }
  return out
}

const KIND = { '+': 'add', '-': 'del', '!': 'del', ' ': '' }
const codeRow = (sign, text) =>
  h(
    'div',
    { class: `row ${KIND[sign] ?? ''}` },
    h(
      'span',
      { class: 'sign', 'aria-hidden': 'true' },
      sign === '+' || sign === '-' ? sign : '',
    ),
    h('span', { class: 'txt' }, text || ' '),
  )
const noteRow = (text) =>
  h('div', { class: 'row' }, h('span', { class: 'note' }, '▲ ', text))
/** The code of one version. `notes` maps a line number (from 0) to a note shown under that line. */
const codeBlock = (title, source, notes = new Map()) =>
  h(
    'div',
    { class: 'code' },
    h('div', { class: 'head' }, title),
    h(
      'div',
      { class: 'body' },
      linesOf(source).flatMap((l, i) => [
        codeRow(notes.has(i) ? '!' : ' ', l),
        notes.has(i) ? noteRow(notes.get(i)) : null,
      ]),
    ),
  )
const diffBlock = (a, b) =>
  h(
    'div',
    { class: 'code' },
    h(
      'div',
      { class: 'head' },
      `logic/v${a.version}.ts → logic/v${b.version}.ts`,
    ),
    h(
      'div',
      { class: 'body' },
      diff(a.source, b.source).map(([sign, text]) => codeRow(sign, text)),
    ),
  )

/** Lines of the agent's own code, with their real line numbers. The marked lines are what this step ran; a note under a line says it in plain words. */
function sourceBlock(point, sources) {
  const rows = sources[point.file]
    ? excerpt(sources[point.file], point.marks)
    : null
  if (!rows) {
    return h(
      'p',
      { class: 'muted' },
      `The lines of src/${point.file} are not loaded.`,
    )
  }
  return h(
    'div',
    { class: 'code lines' },
    h('div', { class: 'head' }, `src/${point.file}`),
    h(
      'div',
      { class: 'body' },
      rows.flatMap((row) => {
        if (row.gap) {
          return h(
            'div',
            { class: 'row skip' },
            h('span', { class: 'sign', 'aria-hidden': 'true' }, '⋯'),
            h('span', { class: 'txt' }, ' '),
          )
        }
        const code = h(
          'div',
          { class: `row${row.hot ? ' hot' : ''}` },
          h('span', { class: 'sign' }, String(row.n)),
          h('span', { class: 'txt' }, row.text || ' '),
        )
        return [
          code,
          row.note
            ? h(
                'div',
                { class: 'row' },
                h('span', { class: 'note tone-now' }, '▲ ', row.note),
              )
            : null,
        ]
      }),
    ),
  )
}

/** One log line in plain words. */
function line(e) {
  switch (e.kind) {
    case 'start':
      return `Supervisor started the agent, pid ${e.child}.`
    case 'exit':
      return `Agent ${e.child} ended: ${e.signal ?? `exit code ${e.code}`}.`
    case 'boot':
      return `Ready with rule v${e.version}${e.resumed ? ', resumed from the log' : ''}.`
    case 'logic.proposed':
      return `Wrote rule v${e.version}, asked for a restart.`
    case 'logic.trying':
      return `Check of rule v${e.version} begins.`
    case 'logic.accepted':
      return `Rule v${e.version} accepted.`
    case 'logic.rejected':
      return `Rule v${e.version} rejected: ${stop(e.error)}`
    case 'ticket':
      return `Ticket ${e.ticket} → ${e.queue}${e.urgent ? ', urgent' : ''} (rule v${e.version}).`
    case 'done':
      return e.answer || `Ended: ${e.reason ?? e.status}.`
    default:
      return `Error: ${e.message}`
  }
}

/** The log lines of this step, as they are in the file. The code of a rule and the record of its check are left out here. */
function rawLines(scene, events) {
  const rows = events
    .slice(scene.from, scene.end)
    .map(({ id, source, trial, ...e }) =>
      JSON.stringify({
        ...e,
        ...(source === undefined ? {} : { source: '…' }),
        ...(trial === undefined ? {} : { trial: '…' }),
      }),
    )
  return qa(
    `The log ${rows.length === 1 ? 'line' : 'lines'} of this step`,
    h('pre', { class: 'json' }, rows.join('\n')),
  )
}

export function codeBlocks(scene, st, fin, events, sources) {
  const active = st.rules.get(st.active)
  const blocks = []
  switch (scene.kind) {
    case 'start':
    case 'ticket':
      if (active) {
        blocks.push(
          qa(
            `Rule v${active.version}: the code in use`,
            codeBlock(`logic/v${active.version}.ts`, active.source),
            'The agent calls route(ticket) for each ticket. It can replace this file, and only this file.',
          ),
        )
      }
      break
    case 'write': {
      const r = st.rules.get(scene.version)
      const base = st.rules.get(r.base)
      if (base?.source) {
        blocks.push(
          qa(
            `What the agent wrote: rule v${base.version} → v${r.version}`,
            diffBlock(base, r),
            'Red lines are removed, green lines are added.',
          ),
        )
      } else {
        blocks.push(
          qa(
            `What the agent wrote: rule v${r.version}`,
            codeBlock(`logic/v${r.version}.ts`, r.source),
          ),
        )
      }
      blocks.push(
        qa(
          'The lines that write the new rule',
          "This is the agent's own code. The marked lines ran in this step.",
          sourceBlock(POINTS.write, sources),
        ),
      )
      break
    }
    case 'restart': {
      const old = st.procs.at(scene.started ? -2 : -1)
      const proc = scene.started ? st.procs.at(-1) : null
      blocks.push(
        qa(
          'Two processes, one job',
          old
            ? `Process ${old.n} had pid ${old.pid}. ${ending(old.exit)?.long ?? ''}`
            : null,
          proc
            ? `Process ${proc.n} has pid ${proc.pid}. The supervisor started it.${proc.boot?.resumed ? ' Its first log line says: resumed.' : ''}`
            : null,
          sourceBlock(POINTS.spawn, sources),
        ),
      )
      if (proc) {
        blocks.push(
          qa(
            'The lines that recover from the log',
            `Process ${proc.n} runs these lines of the agent's code. They are why no work is lost.`,
            sourceBlock(POINTS.recover, sources),
          ),
        )
      }
      break
    }
    case 'check': {
      const r = st.rules.get(scene.version)
      if (r.status === 'rejected' && r.source) {
        const src = linesOf(r.source)
        const notes = new Map()
        // A rule that returns nothing fell out of the end of its function: mark that line.
        if (/returned undefined/.test(r.error ?? '')) {
          notes.set(
            src.findLastIndex((l) => l.trim() === '}'),
            'A ticket that matches no line above arrives here. The function ends without an answer.',
          )
        }
        blocks.push(
          qa(
            `The bad line in the agent's rule v${r.version}`,
            h('p', { class: 'quote' }, r.error),
            codeBlock(`logic/v${r.version}.ts`, r.source, notes),
          ),
        )
        const fix = [...fin.rules.values()].find(
          (o) =>
            o.version > r.version &&
            (o.status === 'active' || o.status === 'removed') &&
            o.source,
        )
        if (fix) {
          blocks.push(
            qa(`The fix, later, in rule v${fix.version}`, diffBlock(r, fix)),
          )
        }
        // A check that the process did not finish has no trial: the next process rejected the rule without these lines.
        if (r.trial) {
          blocks.push(
            qa(
              `The lines that reject rule v${r.version}`,
              sourceBlock(POINTS.reject, sources),
            ),
          )
        }
      } else if (r.status === 'active') {
        const before = st.rules.get(r.replaced)
        if (before?.source) {
          blocks.push(
            qa(
              `The swap in code: rule v${before.version} → v${r.version}`,
              diffBlock(before, r),
              'Red lines are removed, green lines are added. The agent wrote the green lines.',
            ),
          )
          blocks.push(
            qa(
              `The lines that put rule v${r.version} in`,
              sourceBlock(POINTS.accept, sources),
            ),
          )
        }
      } else if (r.source) {
        blocks.push(
          qa(
            `Rule v${r.version}, in the check`,
            codeBlock(`logic/v${r.version}.ts`, r.source),
          ),
        )
      }
      break
    }
    case 'done': {
      const rows = []
      let proc = 0
      for (const e of events) {
        if (e.kind === 'start') {
          rows.push(
            h('li', { class: 'sep' }, `Process ${++proc} · pid ${e.child}`),
          )
        }
        rows.push(
          h(
            'li',
            {},
            h('span', { class: 'mono' }, `#${e.id}`),
            h('span', {}, line(e)),
          ),
        )
      }
      return [
        qa(
          `The whole log: ${plural(events.length, 'line', 'lines')}`,
          h('ol', { class: 'plog' }, rows),
        ),
      ]
    }
  }
  blocks.push(rawLines(scene, events))
  return blocks
}
