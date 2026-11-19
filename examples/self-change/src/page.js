// The page reads the log through /api/events and shows it as steps (page-steps.js makes them).
// The picture of a step is the state of the run after its log lines. The page holds no state of
// the job: every ticket, rule, verdict and line of code on it comes from the log.
import { codeBlocks, whyBlocks } from './page-deep.js'
import { badge, h, icon, mark } from './page-dom.js'
import { FILES } from './page-source.js'
import * as steps from './page-steps.js'
import {
  changedBy,
  ending,
  ownerDone,
  plural,
  resumePoint,
  same,
  sampleFail,
  stop,
  tell,
  textChange,
  where,
} from './page-steps.js'

let run = null,
  events = [],
  inbox = [],
  agentPid = null,
  connected = false
let scenes = [] // the steps of this run so far
let cursor = 0 // the step on the picture
let playing = true // go to the next step by itself, and follow a live run
let shownAt = 0 // when the step on the picture was shown
let level = 1 // 1 picture, 2 why, 3 code
let played = '' // the step whose moment has played: a redraw of the same step shows the still picture
const sources = {} // the agent's own code by file name, for the Code level

/** A step stays this long before Play goes on, so each one can be read. */
const DWELL_MS = 4000
const LEVELS = [
  { n: 1, name: 'Picture' },
  { n: 2, name: 'Why', slug: 'why' },
  { n: 3, name: 'Code', slug: 'code' },
]
const reduced = matchMedia('(prefers-reduced-motion: reduce)')

// ——— the picture ———

/** One ticket card. The same ticket has the same view-transition name in the inbox and in a queue, so it moves between them. */
function ticketCard(id, text, opts = {}) {
  const { cls = '', tone, tags, moves = true, num = String(id) } = opts
  return h(
    'div',
    {
      class: `tk ${cls}${tone ? ` lit tone-${tone}` : ''}`,
      style: moves
        ? `view-transition-name: tk-${id}; view-transition-class: part`
        : undefined,
      title: text,
    },
    h('span', { class: 'num' }, num),
    h('span', { class: 'text' }, text),
    tags?.some(Boolean) ? h('span', { class: 'tags' }, tags) : null,
  )
}

function drawInbox(scene, st) {
  const done = ownerDone(st)
  const busy = !done && [...st.rules.values()].some((r) => r.why !== undefined)
  // A restart step shows what the new process got back from the log: the done places, and the place where it goes on.
  const recovered = scene.kind === 'restart' && scene.started
  const resume = recovered ? resumePoint(st, inbox).item : null
  const goesOn = `process ${st.procs.at(-1)?.n} goes on here`
  const items = inbox.map((item) => {
    if (item.from === 'owner') {
      if (done) {
        return ticketCard(item.id, item.text, {
          cls: 'owner done',
          moves: false,
          num: icon('check'),
          tags: [`from the owner · done with rule v${st.active}`],
        })
      }
      let state = ''
      if (item.id === resume) {
        state = ` · ${goesOn}`
      } else if (busy) {
        state = ' · the agent works on it'
      }
      return ticketCard(item.id, item.text, {
        cls: 'owner',
        moves: false,
        tone: busy || item.id === resume ? 'now' : undefined,
        tags: [`from the owner${state}`],
      })
    }
    if (!st.routed.has(item.id)) {
      return ticketCard(
        item.id,
        item.text,
        item.id === resume ? { tone: 'now', tags: [goesOn] } : {},
      )
    }
    // A done ticket leaves its place in the inbox.
    return ticketCard(item.id, item.text, {
      cls: 'done',
      moves: false,
      num: icon('check'),
      tone: recovered ? 'now' : undefined,
      tags: recovered ? ['done, says the log'] : undefined,
    })
  })
  const left = inbox.filter(
    (item) => item.from === 'customer' && !st.routed.has(item.id),
  ).length
  return h(
    'div',
    { class: 'zone' },
    h(
      'div',
      { class: 'zone-head' },
      h('h2', {}, 'Inbox'),
      h(
        'span',
        { class: 'muted' },
        left
          ? `${plural(left, 'ticket', 'tickets')} to do, in order`
          : 'nothing left to do',
      ),
    ),
    h('div', { class: 'stack' }, items),
  )
}

function drawQueues(scene, st) {
  const here = scene.kind === 'ticket' ? st.routed.get(scene.ticket) : null
  const effectHere = here ? changedBy(st, here) : null
  const active = st.rules.get(st.active)
  return ['support', 'billing'].map((queue) => {
    const cards = [...st.routed.values()]
      .filter((t) => t.queue === queue)
      .map((t) => {
        const effect = changedBy(st, t)
        const isHere = t === here
        // A ticket that was done before the change, and that the rule in use now would send to another place.
        const now =
          active && active.version !== t.version
            ? active.trial?.tickets?.find((o) => o.ticket === t.ticket)
            : null
        const missed = now && !same(now.route, t)
        let tone
        if (isHere) {
          tone = effect?.changed ? 'good' : 'now'
        }
        return ticketCard(t.ticket, t.text, {
          cls: effect?.changed ? 'changed' : '',
          tone,
          tags: [
            t.urgent ? badge('warn', 'urgent') : null,
            effect?.changed ? badge('good solid', 'changed') : null,
            effect?.changed && isHere ? `old rule: ${where(effect.was)}` : null,
            missed ? 'done before the change' : null,
          ],
        })
      })
    // The place this ticket would have taken with the old rule.
    const ghost =
      effectHere?.changed && effectHere.was?.queue === queue
        ? ticketCard(here.ticket, here.text, {
            cls: 'ghost',
            moves: false,
            tags: [
              `the old rule v${st.rules.get(here.version).replaced} would put it here`,
            ],
          })
        : null
    return h(
      'div',
      { class: 'zone' },
      h(
        'div',
        { class: 'zone-head' },
        h('h2', {}, queue === 'support' ? 'Support queue' : 'Billing queue'),
        h(
          'span',
          { class: 'muted' },
          plural(cards.length, 'ticket', 'tickets'),
        ),
      ),
      h(
        'div',
        { class: 'stack' },
        cards,
        ghost,
        cards.length || ghost ? null : h('p', { class: 'none' }, 'Empty.'),
      ),
    )
  })
}

/** The words of a rule. `runs` are its words with the changed ones apart: `ins` marks words that a change added, `del` words that it took away. */
function ruleText(r, runs, tag) {
  if (!runs) {
    return h('p', { class: 'says' }, r.about ?? 'A new rule.')
  }
  return h(
    'p',
    { class: 'says' },
    runs.map((run) => {
      if (run.kept) {
        return run.text
      }
      const words = run.text.trimEnd()
      return [h(tag, {}, words), run.text.slice(words.length)]
    }),
  )
}

/** The state of a rule now, as one badge. */
function ruleState(r, st) {
  if (r.status === 'active') {
    return badge('use solid', 'in use')
  }
  if (r.status === 'rejected') {
    return badge('bad solid', 'rejected')
  }
  if (r.status === 'checking') {
    return badge('now', 'check runs…')
  }
  if (r.status === 'candidate') {
    return badge('now', 'not checked yet')
  }
  const by = [...st.rules.values()].find((o) => o.replaced === r.version)
  return badge('plain', by ? `replaced by v${by.version}` : 'removed')
}

/** The story of a rule in one line: who wrote it, and what its check said. At the step of its check (`open`) the check itself is under this line. */
function ruleStory(r, st, open) {
  if (r.why === undefined) {
    return 'The first rule, from the owner.'
  }
  const failed = [...st.rules.values()].findLast(
    (o) => o.status === 'rejected' && o.version < r.version,
  )
  const origin = failed
    ? `Written by the agent to fix v${failed.version}.`
    : 'Written by the agent.'
  const samples = r.trial?.samples?.length
  if (open) {
    return `${origin} Process ${st.procs.at(-1)?.n} tries it on ${samples ? plural(samples, 'sample ticket', 'sample tickets') : 'sample tickets'} first:`
  }
  if (r.status === 'rejected') {
    return [
      `${origin} `,
      h('b', { class: 'tone-bad' }, 'Its check failed'),
      `: ${sampleFail(r)?.replace(/^v\d+ (gave )?/, '') ?? stop(r.error)}`,
    ]
  }
  if (r.status === 'active' || r.status === 'removed') {
    return [
      `${origin} `,
      h('b', { class: 'tone-good' }, 'It passed its check'),
      samples
        ? ` on ${plural(samples, 'sample ticket', 'sample tickets')}.`
        : '.',
    ]
  }
  return `${origin} It must pass a check before the agent uses it.`
}

/** The check of a rule, open at its own step: each sample ticket, and the verdict. Later steps keep one line of it in the story of the rule. */
function checkDetail(r, st) {
  const samples = r.trial?.samples ?? []
  const ok = r.status !== 'rejected'
  let verdict
  if (ok) {
    verdict = h(
      'div',
      { class: 'verdict tone-good' },
      mark('check'),
      h(
        'span',
        {},
        h('b', {}, 'Passed. '),
        `Rule v${r.version} goes in, rule v${r.replaced} goes out.`,
      ),
    )
  } else {
    verdict = h(
      'div',
      { class: 'verdict tone-bad' },
      mark('x'),
      h(
        'span',
        {},
        h('b', {}, 'Failed. '),
        samples.length ? '' : `${stop(r.error)} `,
        `Rule v${r.version} is rejected, rule v${st.active} stays in use.`,
      ),
      r.source && level < 3
        ? h(
            'button',
            { type: 'button', class: 'btn sm', 'data-zoom': '3' },
            icon('zoom'),
            'Show the bad line',
          )
        : null,
    )
  }
  return h(
    'div',
    { class: 'detail' },
    samples.length
      ? h(
          'ul',
          { class: 'checks' },
          samples.map((o) =>
            h(
              'li',
              { class: o.route ? 'tone-good' : 'tone-bad' },
              mark(o.route ? 'check' : 'x'),
              h('span', {}, `“${o.text}”`),
              o.route ? answer(o.route) : badge('bad solid', 'no answer'),
            ),
          ),
        )
      : null,
    verdict,
  )
}

/** The answer of a rule for a ticket, the same way in the trail and in a queue. */
const answer = (t, changed) => [
  h('span', { class: 'to' }, `→ ${t.queue}`),
  t.urgent ? badge('warn', 'urgent') : null,
  changed ? badge('good solid', 'changed') : null,
]

/** One line of the trail under a rule: a ticket that this rule decided. The ticket of this step is open: it shows the ticket and the answer of the rule. */
function trailLine(t, scene, st) {
  const effect = changedBy(st, t)
  const old = effect ? `v${st.rules.get(t.version).replaced}` : null
  const name = h('span', { class: 'tn' }, `Ticket ${t.ticket}`)
  let note = null
  if (effect) {
    note = effect.changed ? `${old}: ${where(effect.was)}` : `same as ${old}`
  }
  if (scene.kind !== 'ticket' || scene.ticket !== t.ticket) {
    return h(
      'li',
      {},
      name,
      answer(t, effect?.changed),
      note ? h('span', { class: 'note' }, note) : null,
    )
  }
  return h(
    'li',
    { class: `open lit tone-${effect?.changed ? 'good' : 'now'}` },
    name,
    h('span', {}, `“${t.text}”`),
    h(
      'span',
      { class: 'reply' },
      h('b', {}, `Rule v${t.version} answers`),
      answer(t, effect?.changed),
      note ? h('span', { class: 'note' }, note) : null,
    ),
  )
}

/** One rule in the history: its version, its words, its state now, its story, and under it the tickets that it decided. */
function ruleItem(r, scene, st) {
  const active = st.rules.get(st.active)
  const judged = scene.kind === 'check' && scene.version === r.version
  const swapped =
    scene.kind === 'check' &&
    scene.verdict?.kind === 'logic.accepted' &&
    active?.replaced !== null
  // The swap shows what changed in the words of the rule: the new words in the rule that goes in, the dropped words in the rule that goes out.
  const swap = swapped
    ? textChange(st.rules.get(active.replaced)?.about ?? '', active.about ?? '')
    : null
  const base = st.rules.get(r.base)
  let tone, runs
  let tag = 'ins'
  let extra = ''
  if (swapped && r === active) {
    ;[tone, runs, extra] = ['good', swap.now, ' landed']
  } else if (swapped && r.version === active.replaced) {
    ;[runs, tag] = [swap.was, 'del']
  } else if (judged && r.status === 'rejected') {
    tone = 'bad'
  } else if (
    judged ||
    (scene.kind === 'write' && scene.version === r.version)
  ) {
    tone = 'now'
    runs = base?.about && r.about ? textChange(base.about, r.about).now : null
    if (scene.kind === 'write') {
      extra = ' written'
    }
  } else if (scene.kind === 'start' && r === active) {
    tone = 'now'
  }
  const kind = r.status === 'checking' ? 'candidate' : r.status
  const tickets = [...st.routed.values()].filter((t) => t.version === r.version)
  return h(
    'li',
    {
      class: `rule ${kind}${extra}${tone ? ` lit tone-${tone}` : ''}`,
      style: `view-transition-name: rule-${r.version}; view-transition-class: part rule`,
    },
    h('span', { class: 'ver' }, `v${r.version}`),
    ruleText(r, runs, tag),
    ruleState(r, st),
    h(
      'p',
      { class: 'story' },
      ruleStory(r, st, Boolean(judged && scene.verdict)),
    ),
    judged && scene.verdict ? checkDetail(r, st) : null,
    tickets.length
      ? h(
          'ol',
          { class: 'trail' },
          tickets.map((t) => trailLine(t, scene, st)),
        )
      : null,
  )
}

/** Every rule of the run, oldest first. No rule leaves the picture: a replaced rule and a rejected rule stay, dimmed, with their story. */
function drawRules(scene, st) {
  const rules = [...st.rules.values()].sort((a, b) => a.version - b.version)
  if (!rules.length) {
    return h(
      'ol',
      { class: 'rules' },
      h('li', { class: 'none' }, 'The agent loads its first rule…'),
    )
  }
  return h(
    'ol',
    { class: 'rules' },
    rules.map((r) => ruleItem(r, scene, st)),
  )
}

/** A restart as two processes: the one that ended, and the one that started. The numbers are big, because the number is what changes. */
function drawCycle(scene, st) {
  const old = st.procs.at(scene.started ? -2 : -1)
  const next = scene.started ? st.procs.at(-1) : null
  const end = ending(old?.exit)
  const tile = (cls, num, name, state, text) =>
    h(
      'div',
      { class: `proc ${cls}` },
      h('span', { class: 'pnum', 'aria-hidden': 'true' }, num),
      h('div', {}, h('b', {}, name, state), h('span', {}, text)),
    )
  return h(
    'div',
    { class: 'procs' },
    old
      ? tile(
          'off',
          String(old.n),
          `Process ${old.n}`,
          badge(
            end?.word === 'stopped' ? 'plain' : 'bad',
            end?.word ?? 'ended',
          ),
          'Its memory is gone.',
        )
      : h('div', {}),
    h('div', { class: 'between', 'aria-hidden': 'true' }, icon('arrow')),
    next
      ? tile(
          'on',
          String(next.n),
          `Process ${next.n}`,
          badge('now solid', 'started'),
          'It reads the log on disk.',
        )
      : tile(
          'wait',
          h('span', { class: 'pulse' }, '…'),
          'A new process',
          null,
          'starts in a moment…',
        ),
  )
}

/** Every process of the run in the head of the agent, as plates in a row: the ones that ended stay, dimmed, with the word for how they ended. */
function drawLife(scene, st) {
  if (!st.procs.length) {
    return badge('plain', 'not started')
  }
  const started = scene.kind === 'restart' && scene.started
  const plate = (p, cls, word, dot) =>
    h(
      'li',
      {
        class: `plate ${cls}`,
        style: `view-transition-name: proc-${p.n}`,
        title: ending(p.exit, p.loads)?.long,
      },
      dot ? h('span', { class: `dot ${dot}` }) : null,
      h('span', { class: 'word' }, 'Process'),
      h('b', {}, String(p.n)),
      h('span', { class: 'state' }, word),
    )
  const then = () =>
    h('li', { class: 'then', 'aria-hidden': 'true' }, icon('arrow'))
  const row = st.procs.flatMap((p, i) => {
    const word = ending(p.exit)?.word
    let item
    if (!p.exit) {
      item = plate(
        p,
        started ? 'lit' : '',
        started ? 'started' : 'running',
        'pulse',
      )
    } else if (word === 'finished') {
      item = plate(p, '', word)
    } else {
      item = plate(p, `off${word === 'stopped' ? '' : ' bad'}`, word)
    }
    return i ? [then(), item] : [item]
  })
  const last = st.procs.at(-1)
  if (last.exit && last.exit.code !== 0) {
    row.push(then(), h('li', { class: 'plate wait pulse' }, 'restarting…'))
  }
  return h(
    'ol',
    {
      class: `life${st.procs.length > 3 ? ' many' : ''}`,
      'aria-label': 'The processes of this run',
    },
    row,
  )
}

function drawAgent(scene, st) {
  const proc = st.procs.at(-1)
  const cycle = scene.kind === 'restart'
  let cls = 'card agent'
  if (proc?.exit && proc.exit.code !== 0) {
    cls += ' stopped'
  }
  if (cycle && scene.started) {
    cls += ' up'
  }
  return h(
    'div',
    { class: cls },
    h(
      'div',
      { class: 'agent-head' },
      h('h2', {}, 'Agent'),
      drawLife(scene, st),
    ),
    // A restart step puts the two processes first: the restart is what the step is about.
    cycle ? drawCycle(scene, st) : null,
    drawRules(scene, st),
    scene.kind === 'start'
      ? h(
          'p',
          { class: 'muted' },
          'For each ticket the agent asks its rule one question: “Where does this ticket go?” The rule answers with a queue, and urgent or not.',
        )
      : null,
    scene.kind === 'done' && st.done?.answer
      ? h(
          'p',
          { class: 'report' },
          h('b', {}, 'The agent reports: '),
          `“${st.done.answer}”`,
        )
      : null,
  )
}

/** An arrow between two parts. `on` gives it the color of this step. */
function wire(on, tone) {
  const box = h('span', { style: 'display: contents' })
  box.innerHTML = `<svg class="wire${on ? ` on tone-${tone}` : ''}" viewBox="0 0 40 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 8h36"/><path d="M31 2l7 6-7 6"/></svg>`
  return box
}

/**
 * The log on disk, one row per process: what it wrote, and how it ended. Each entry has the color of its step
 * in the timeline and opens that step, so the log and the steps read as one story.
 */
function drawTape(scene, st, fin, told) {
  const lit = scene.kind === 'restart' && scene.started
  const stepOf = (index) =>
    scenes.findIndex((s) => index >= s.from && index < s.end)
  const entry = (index, text, cls = '') => {
    const step = stepOf(index)
    const tone = told[step]?.tone
    const here = index >= scene.from && index < scene.end
    return h(
      'button',
      {
        type: 'button',
        class: `ent${cls}${tone ? ` tone-${tone}` : ''}${here ? ' lit' : ''}`,
        'data-step': String(step),
        title: `Open step ${step + 1}`,
      },
      h('span', { class: 'pip' }),
      text,
    )
  }
  const rows = st.procs.map((p) => {
    const wrote = st.tape
      .filter((o) => o.proc === p.n)
      .map((o) => entry(o.index, o.text))
    const end = ending(p.exit, p.loads)
    // Each process after the first one starts from the log. At a restart step its row says where the log sends it.
    let lead = p.n === 1 ? null : 'read the log'
    if (lit && p === st.procs.at(-1)) {
      lead = `reads the log, then goes on with ${resumePoint(st, inbox).text}`
    } else if (lead && (wrote.length || end)) {
      lead += ' →'
    }
    let tail = null
    if (end) {
      tail = entry(p.exitIndex, end.did, ' end')
    }
    return h(
      'li',
      { class: `prow${lit && p === st.procs.at(-1) ? ' lit' : ''}` },
      h('b', { class: 'pname' }, `Process ${p.n}`),
      h(
        'span',
        { class: 'pline' },
        lead ? h('span', { class: 'lead' }, lead) : null,
        wrote,
        tail,
      ),
    )
  })
  const reader = st.procs.at(-1)
  return h(
    'div',
    { class: `tape${lit ? ' lit' : ''}` },
    h(
      'div',
      { class: 'tape-head' },
      h('h2', {}, 'Log on disk'),
      h(
        'p',
        {},
        lit
          ? `Process ${reader.n} reads this. It is all the agent remembers.`
          : 'The agent writes each finished step here. The log stays when a process ends. An entry opens its step.',
      ),
    ),
    // The log keeps the room of all its rows from the first step, so the picture does not move when a process starts.
    h(
      'ol',
      { class: 'tape-rows', style: `--rows: ${fin.procs.length}` },
      rows.length ? rows : h('li', { class: 'none' }, 'Empty.'),
    ),
  )
}

function drawStage(scene, st, fin, told) {
  const stage = document.getElementById('stage')
  if (!scene) {
    let wait = 'The supervisor starts the agent…'
    if (!connected) {
      wait =
        run === null
          ? 'Connecting to the supervisor…'
          : 'The page cannot reach the supervisor. Start it with npm start.'
    }
    return stage.replaceChildren(h('p', { class: 'none' }, wait))
  }
  const t = scene.kind === 'ticket' ? st.routed.get(scene.ticket) : null
  const tone = t && changedBy(st, t)?.changed ? 'good' : 'now'
  const [support, billing] = drawQueues(scene, st)
  stage.replaceChildren(
    h(
      'div',
      { class: 'flow' },
      drawInbox(scene, st),
      h(
        'div',
        { class: 'gut' },
        wire(Boolean(t) || scene.kind === 'write', tone),
      ),
      drawAgent(scene, st),
      h(
        'div',
        { class: 'gut two' },
        wire(t?.queue === 'support', tone),
        wire(t?.queue === 'billing', tone),
      ),
      h('div', { class: 'queues' }, support, billing),
    ),
    drawTape(scene, st, fin, told),
  )
}

// ——— the caption, the steps, the top ———

function drawCaption(scene, told) {
  const box = document.getElementById('caption')
  if (!scene) {
    return box.replaceChildren(
      h('span', { class: 'mark' }, icon('info')),
      h(
        'div',
        {},
        h(
          'p',
          { class: 'say' },
          connected
            ? 'Waiting for the first step…'
            : 'Waiting for the supervisor…',
        ),
      ),
    )
  }
  const toneIcon =
    { good: 'check', bad: 'x' }[told.tone] ??
    { restart: 'restart', done: 'flag' }[scene.kind] ??
    'info'
  const deeper = LEVELS[level]
  box.replaceChildren(
    h(
      'span',
      {
        class: `mark${told.tone ? ` tone-${told.tone}` : ''}`,
        'aria-hidden': 'true',
      },
      icon(toneIcon),
    ),
    h(
      'div',
      {},
      h('p', { class: 'say' }, told.say),
      h('p', { class: 'why' }, told.why),
    ),
    h(
      'div',
      { class: 'more' },
      deeper
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn sm',
              'data-zoom': String(deeper.n),
              title: `Zoom in to level ${deeper.n} (+)`,
            },
            icon('zoom'),
            deeper.n === 2 ? 'Why?' : 'Show the code',
          )
        : null,
    ),
  )
}

/** The timeline buttons are made once per step and then only change state, so focus survives a redraw. */
function drawTimeline(told) {
  const box = document.getElementById('timeline')
  while (box.children.length > scenes.length) {
    box.lastChild.remove()
  }
  while (box.children.length < scenes.length) {
    box.append(
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', 'data-step': String(box.children.length) },
          h('span', { class: 'pip' }),
          h('span', {}),
        ),
      ),
    )
  }
  // When the names of the steps do not fit side by side, only the step on the picture keeps its name.
  box.classList.toggle(
    'dense',
    box.clientWidth / Math.max(1, scenes.length) < 56,
  )
  scenes.forEach((_, i) => {
    const button = box.children[i].firstChild
    const { label, tone } = told[i]
    button.className = `${tone ? `tone-${tone}` : ''}${i < cursor ? ' past' : ''}`
    if (i === cursor) {
      button.setAttribute('aria-current', 'step')
    } else {
      button.removeAttribute('aria-current')
    }
    button.title = `Step ${i + 1}: ${label}`
    if (button.lastChild.textContent !== label) {
      button.lastChild.textContent = label
    }
  })
}

function drawControls() {
  const last = scenes.length - 1
  document.getElementById('prev').disabled = cursor <= 0
  document.getElementById('next').disabled = cursor >= last
  const play = document.getElementById('play')
  const atEnd = cursor >= last && finished()
  let [name, text] = playing ? ['pause', 'Pause'] : ['play', 'Play']
  if (!playing && atEnd && last > 0) {
    ;[name, text] = ['restart', 'Replay']
  }
  if (play.dataset.v !== text) {
    play.dataset.v = text
    play.replaceChildren(icon(name), text)
  }
  let count = scenes.length ? `Step ${cursor + 1} of ${scenes.length}` : ''
  if (scenes.length && !finished()) {
    count += connected ? ' so far' : ''
  }
  document.getElementById('count').textContent = count

  let [tone, text2, dot] = agentPid
    ? ['good', 'Agent runs live', 'pulse']
    : ['now', 'Agent restarts…', 'pulse']
  if (!connected) {
    ;[tone, text2, dot] = ['bad', 'Supervisor not reachable', true]
  } else if (events.some((e) => e.kind === 'error' && e.by === 'supervisor')) {
    ;[tone, text2, dot] = ['bad', 'Supervisor gave up', true]
  } else if (finished()) {
    ;[tone, text2, dot] = ['plain', 'Run finished', true]
  }
  const status = document.getElementById('status')
  if (status.dataset.v !== text2) {
    const fresh = Object.assign(badge(tone, text2, dot), {
      id: 'status',
      title: 'The state of the real agent process, now',
    })
    fresh.dataset.v = text2
    status.replaceWith(fresh)
  }
  document.getElementById('kill').disabled =
    !connected || !agentPid || finished()

  const levels = document.getElementById('levels')
  if (!levels.querySelector('button')) {
    levels.append(
      ...LEVELS.map((l) =>
        h(
          'button',
          {
            type: 'button',
            'data-zoom': String(l.n),
            title: `Level ${l.n}: ${l.name} (key ${l.n})`,
          },
          l.name,
        ),
      ),
    )
  }
  for (const button of levels.querySelectorAll('button')) {
    button.setAttribute(
      'aria-pressed',
      String(Number(button.dataset.zoom) === level),
    )
  }
  document.getElementById('zoom-out').disabled = level === 1
  document.getElementById('zoom-in').disabled = level === LEVELS.length
}

function drawPanel(scene, st, fin) {
  const panel = document.getElementById('panel')
  if (level === 1 || !scene) {
    return panel.replaceChildren()
  }
  const keep =
    panel.dataset.v === `${cursor}:${level}`
      ? (panel.querySelector('.panel-body')?.scrollTop ?? 0)
      : 0
  panel.dataset.v = `${cursor}:${level}`
  const title =
    level === 2
      ? 'Why this step works like this'
      : 'The code and the log of this step'
  const body = h(
    'div',
    { class: 'panel-body' },
    level === 2
      ? whyBlocks(scene, st, fin)
      : codeBlocks(scene, st, fin, events, sources),
  )
  panel.replaceChildren(
    h(
      'div',
      { class: 'panel-head' },
      h('h2', {}, title),
      h(
        'button',
        {
          type: 'button',
          class: 'btn sm',
          'data-zoom': String(level - 1),
          title: 'Zoom out (−)',
        },
        icon('out'),
        'Zoom out',
      ),
    ),
    body,
  )
  body.scrollTop = keep
}

// ——— drawing, stepping, zoom ———

const replay = (upto) => steps.replay(events, upto)
const finished = () => steps.finished(events)

function paint() {
  const scene = scenes[cursor]
  const fin = replay(events.length)
  const told = scenes.map((s) => tell(s, replay(s.end), fin))
  const st = scene ? replay(scene.end) : null
  document.documentElement.dataset.level = String(level)
  // The moment of a step (a rule that goes in, a process that comes back) plays once, when the step comes on the picture.
  const moment = scene ? `${cursor}:${scene.end}` : ''
  document.getElementById('stage').classList.toggle('play', moment !== played)
  played = moment
  drawStage(scene, st, fin, told)
  drawCaption(scene, told[cursor])
  drawTimeline(told)
  drawPanel(scene, st, fin)
  drawControls()
}

/** Draw the page. A change of step or of depth is a view transition, so named parts move to their new place. */
function draw(animate = false) {
  if (
    animate &&
    document.startViewTransition &&
    !reduced.matches &&
    !document.hidden
  ) {
    document.startViewTransition(paint)
  } else {
    paint()
  }
}

const hashOf = () =>
  `#step-${cursor + 1}${level > 1 ? `/${LEVELS[level - 1].slug}` : ''}`
const keepHash = () => scenes.length && history.replaceState(null, '', hashOf())

/** Show another step. A step chosen by the reader stops Play. */
function go(to, byReader = true) {
  const next = Math.min(scenes.length - 1, Math.max(0, to))
  if (byReader) {
    playing = false
  }
  if (next === cursor) {
    return drawControls()
  }
  cursor = next
  shownAt = Date.now()
  keepHash()
  draw(true)
}

function setLevel(wanted) {
  const next = Math.min(LEVELS.length, Math.max(1, wanted))
  if (next === level) {
    return
  }
  level = next
  keepHash()
  draw(true)
}

function togglePlay() {
  if (playing) {
    playing = false
  } else {
    playing = true
    if (cursor >= scenes.length - 1 && finished()) {
      return go(0, false)
    }
    shownAt = Date.now() - DWELL_MS / 2
  }
  drawControls()
}

/** Play: after the dwell, go to the next step when the log has one. At the end of a finished run Play stops. */
setInterval(() => {
  if (!playing || !scenes.length || Date.now() - shownAt < DWELL_MS) {
    return
  }
  if (cursor < scenes.length - 1) {
    go(cursor + 1, false)
  } else if (finished()) {
    playing = false
    drawControls()
  }
}, 200)

document.addEventListener('click', (event) => {
  const zoom = event.target.closest('[data-zoom]')
  if (zoom) {
    return setLevel(Number(zoom.dataset.zoom))
  }
  const step = event.target.closest('[data-step]')
  if (step) {
    go(Number(step.dataset.step))
  }
})
document
  .getElementById('zoom-in')
  .addEventListener('click', () => setLevel(level + 1))
document
  .getElementById('zoom-out')
  .addEventListener('click', () => setLevel(level - 1))
document.getElementById('prev').addEventListener('click', () => go(cursor - 1))
document.getElementById('next').addEventListener('click', () => go(cursor + 1))
document.getElementById('play').addEventListener('click', togglePlay)
document
  .getElementById('kill')
  .addEventListener('click', () => fetch('/api/kill', { method: 'POST' }))
document
  .getElementById('reset')
  .addEventListener('click', () => fetch('/api/reset', { method: 'POST' }))
document.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof Element &&
    event.target.closest('input, textarea, select, [contenteditable]')
  if (event.metaKey || event.ctrlKey || event.altKey || typing) {
    return
  }
  const onButton =
    event.target instanceof Element && event.target.closest('button')
  if (event.key === 'ArrowRight') {
    go(cursor + 1)
  } else if (event.key === 'ArrowLeft') {
    go(cursor - 1)
  } else if (event.key === ' ' && !onButton) {
    togglePlay()
  } else if (event.key === '+' || event.key === '=') {
    setLevel(level + 1)
  } else if (event.key === '-' || event.key === '_') {
    setLevel(level - 1)
  } else if (event.key === 'Escape') {
    setLevel(1)
  } else if (/^[1-3]$/.test(event.key)) {
    setLevel(Number(event.key))
  } else {
    return
  }
  event.preventDefault()
})

/** A link names a step and a depth: #step-6, #step-6/why, #step-6/code. A step in the link stops Play. */
function readHash() {
  const found = /^#step-(\d+)(?:\/(why|code))?$/.exec(location.hash)
  if (!found) {
    return false
  }
  level = LEVELS.find((l) => l.slug === found[2])?.n ?? 1
  cursor = Math.max(0, Number(found[1]) - 1)
  playing = false
  return true
}
window.addEventListener('resize', () => draw())
window.addEventListener('hashchange', () => {
  if (!readHash()) {
    return
  }
  cursor = Math.min(cursor, Math.max(0, scenes.length - 1))
  draw(true)
})

/** The log lines that are new since the last poll, or null when the supervisor does not answer. */
async function load() {
  try {
    const after = events.at(-1)?.id ?? 0
    const data = await (await fetch(`/api/events?after=${after}`)).json()
    // The log of a new run starts again at line 1: take all of it.
    if (data.run !== run && after) {
      data.events = (await (await fetch('/api/events')).json()).events
    }
    return data
  } catch {
    return null
  }
}

/** Twice a second: read the new log lines and draw what changed. An error in drawing is not caught here, so the console shows it. */
async function poll() {
  try {
    const data = await load()
    if (!data) {
      if (connected || run === null) {
        connected = false
        draw()
      }
      return
    }
    const fresh = data.run !== run
    const first = run === null
    if (fresh) {
      run = data.run
      events = []
    }
    const changed =
      fresh ||
      !connected ||
      data.events.length > 0 ||
      data.agent.pid !== agentPid
    events.push(...data.events)
    inbox = data.inbox
    agentPid = data.agent.pid
    connected = true
    if (!changed) {
      return
    }
    const before = `${cursor}:${scenes[cursor]?.end}`
    scenes = steps.scenesOf(events)
    // A new run starts at step 1 and plays. The first load keeps the step of the link, if it has one.
    if (fresh && !(first && readHash())) {
      cursor = 0
      playing = true
      shownAt = Date.now()
    }
    cursor = Math.min(cursor, Math.max(0, scenes.length - 1))
    keepHash()
    draw(!first && before !== `${cursor}:${scenes[cursor]?.end}`)
  } finally {
    setTimeout(poll, 500)
  }
}

/** The agent's own code for the Code level. The page shows real lines of these files; without them that level says so. */
async function loadSources() {
  await Promise.all(
    FILES.map(async (name) => {
      const answer = await fetch(`/source/${name}`).catch(() => null)
      if (answer?.ok) {
        sources[name] = await answer.text()
      }
    }),
  )
  if (level === 3) {
    draw()
  }
}

draw()
// poll() plans its own next run, so nothing waits for it.
void poll()
void loadSources()
