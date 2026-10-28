import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('go')

// The question shown first: FB-102 is closed in the copy and reopened on day 3.
const SAMPLE = 'q5'

// One batch at a time: { [modeId]: { [questionId]: run | { error } | null } }.
let results = null
let batchId = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const verdictLabel = (id) => setup.verdicts.find((v) => v.id === id).label
// Red only for a stale value stated as current; an old value said to be old is blue.
const VERDICT_CLASS = {
  correct: 'mx-good',
  stale: 'mx-bad',
  dated: 'pn-old',
  other: 'mx-muted',
}
const finished = (modeId) =>
  setup.questions
    .map((q) => results?.[modeId][q.id])
    .filter((r) => r && !r.error)
const issueOf = (q) => setup.issues.find((i) => i.before.id === q.issue)
const tool = setup.modes.find((m) => m.toolDefinitions.length)
  .toolDefinitions[0]

// ── The notes: each mode's note as the agent reads it, key parts marked ──

/** The note text, with each key part in a <mark>. */
function markedNote(text, marks) {
  const escaped = marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // split() with one capture group: the odd items are the marked parts.
  return el(
    'pre',
    { class: 'pn-note' },
    text
      .split(new RegExp(`(${escaped.join('|')})`))
      .map((part, i) => (i % 2 ? el('mark', {}, part) : part)),
  )
}

function noteCard(m) {
  // The dated note repeats the copied table: show what it adds, and the full note in a fold.
  const body =
    m.id === 'dated'
      ? [
          markedNote(m.marks.join('\n'), m.marks),
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el('span', { class: 'mx-label' }, 'Full note'),
              el(
                'span',
                { class: 'mx-small mx-muted' },
                plural(m.note.split('\n').length, 'line'),
              ),
            ),
            el('div', { class: 'pn-pad' }, markedNote(m.note, m.marks)),
          ),
        ]
      : [markedNote(m.note, m.marks)]

  return el(
    'article',
    { class: 'mx-panel pn-card' },
    el('h3', { class: 'pn-card-title' }, m.label),
    el('p', { class: 'mx-small mx-muted' }, m.about),
    body,
    el(
      'p',
      { class: 'pn-tool' },
      el('span', { class: 'mx-label' }, 'Tool'),
      m.toolDefinitions.length
        ? [el('code', {}, tool.name), ` ${tool.description}`]
        : 'None. The agent has only this note.',
    ),
  )
}

document.getElementById('notes-lead').textContent =
  `The project note, written on day 0 (${setup.day0}), in three versions. The marked text is what makes each one different.`
document.getElementById('notes').replaceChildren(...setup.modes.map(noteCard))

// ── What changed in the tracker between day 0 and day 3 ────────────────

const changed = setup.issues.filter((i) => i.change)
document.getElementById('changes-lead').textContent =
  `On day 3 (${setup.day3}), ${changed.length} of the ${setup.issues.length} issues are different in the tracker. The copied notes still show day 0.`
document.getElementById('changes').replaceChildren(
  ...changed.map(({ before, after, change }) => {
    const field = before.status !== after.status ? 'status' : 'assignee'
    return el(
      'tr',
      {},
      el('td', { class: 'pn-id' }, before.id),
      el('td', {}, before.title),
      el('td', { class: 'pn-nowrap' }, change),
      el('td', { class: 'pn-nowrap' }, el('code', {}, before[field])),
      el(
        'td',
        { class: 'pn-nowrap' },
        el('code', { class: 'pn-now' }, after[field]),
      ),
    )
  }),
)

// ── Reference: the questions, the instructions and the tool ────────────

const askChanged = setup.questions.filter((q) => issueOf(q).change).length
document.getElementById('question-count').textContent =
  `${setup.questions.length}, ${askChanged} about changed issues`
document
  .getElementById('questions')
  .replaceChildren(...setup.questions.map((q) => el('li', {}, q.text)))
document.getElementById('instructions-count').textContent =
  `${setup.modes.length} modes, tool schema, answer schema`
document
  .getElementById('instructions')
  .replaceChildren(
    ...setup.modes.flatMap((m) => [
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `${m.label}: the instructions${m.toolDefinitions.length ? ' and the tool' : '. No tools'}.`,
      ),
      codeBlock(m.instructions, 'md'),
      ...(m.toolDefinitions.length
        ? [codeBlock(prettyJson(m.toolDefinitions), 'json')]
        : []),
    ]),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'The answer schema is the same in every mode. In "current", the agent says that it states the issue as it is today.',
    ),
    codeBlock(prettyJson(setup.schema), 'json'),
  )

// ── Settings ───────────────────────────────────────────────────────────

// One run per question and mode: 1 request without the tool, about 2 with it.
const requests = setup.modes.reduce(
  (n, m) => n + setup.questions.length * (m.toolDefinitions.length ? 2 : 1),
  0,
)
document.getElementById('empty').textContent =
  `Run all modes: the agent answers ${setup.questions.length} questions on day 3, once with each note. About ${requests} requests, under 1 cent.`

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── The headline: answers that match day 3, per mode ───────────────────

function count(modeId, verdict) {
  return finished(modeId).filter((r) => r.verdict === verdict).length
}

/** One sentence on what this batch shows. It follows the numbers, so it can say the effect did not show. It does not repeat the readouts. */
function meaning() {
  const [copy, pointer, dated] = setup.modes.map((m) => finished(m.id))
  if (
    copy.length < setup.questions.length ||
    pointer.length < setup.questions.length
  ) {
    return ''
  }

  const copyPart = count('copy', 'stale')
    ? 'The copied note gave old values as current: it cannot see the changes in the tracker.'
    : 'In this batch, the copied note gave no old value as current.'
  const pointerPart =
    count('pointer', 'correct') === pointer.length
      ? ' The pointer note read each issue from the tracker and always matched day 3.'
      : ' The pointer note missed some answers. Look at its rows below.'

  const tokens = (list) => list.reduce((n, r) => n + r.usage.inputTokens, 0)
  const unread = dated.filter((r) => !r.fetched).length
  const datedPart =
    dated.length < setup.questions.length
      ? ''
      : unread
        ? ` The dated copy answered ${unread} of ${dated.length} questions without a read from the tracker.`
        : ` The dated copy also read every issue before it answered${tokens(dated) > tokens(pointer) ? '. Its copied table adds input tokens and no value' : ''}.`

  return `${copyPart}${pointerPart}${datedPart}`
}

function sumUsage(list) {
  return list.reduce(
    (t, r) =>
      t
        ? {
            inputTokens: t.inputTokens + r.usage.inputTokens,
            outputTokens: t.outputTokens + r.usage.outputTokens,
            reasoningTokens: t.reasoningTokens + r.usage.reasoningTokens,
            cost:
              t.cost == null || r.usage.cost == null
                ? null
                : t.cost + r.usage.cost,
            costSource:
              t.costSource === 'estimate' || r.usage.costSource === 'estimate'
                ? 'estimate'
                : r.usage.costSource,
          }
        : { ...r.usage },
    null,
  )
}

function renderResult() {
  document.getElementById('result').hidden = false
  document.getElementById('readouts').replaceChildren(
    ...setup.modes.map((m) => {
      const done = finished(m.id)
      return el(
        'div',
        { class: 'mx-readout' },
        el('span', { class: 'mx-label pn-nowrap' }, m.label),
        el(
          'b',
          {},
          done.length ? `${count(m.id, 'correct')} of ${done.length}` : '…',
        ),
      )
    }),
  )
  document.getElementById('meaning').textContent = meaning()

  // The other verdicts and the costs; "Matches day 3" is the readout above.
  document
    .getElementById('counts-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, ''),
        ...setup.modes.map((m) => el('th', { class: 'num' }, m.label)),
      ),
    )

  const rows = [
    ...setup.verdicts
      .filter((v) => v.id !== 'correct')
      .map((v) => [
        v.label,
        (done, m) =>
          el(
            'span',
            { class: count(m.id, v.id) ? VERDICT_CLASS[v.id] : '' },
            String(count(m.id, v.id)),
          ),
      ]),
    ['Tool calls', (done) => String(done.reduce((n, r) => n + r.toolCalls, 0))],
    [
      'Requests',
      (done) => String(done.reduce((n, r) => n + r.steps.length, 0)),
    ],
    [
      'Tokens in / out',
      (done) => {
        const u = sumUsage(done)
        return `${u.inputTokens.toLocaleString('en-US')} / ${u.outputTokens.toLocaleString('en-US')}`
      },
    ],
    [
      'Cost',
      (done) => {
        const u = sumUsage(done)
        return `${formatCost(u.cost)}${u.costSource === 'estimate' ? ' est.' : ''}`
      },
    ],
    [
      'Model time',
      (done) => `${(done.reduce((n, r) => n + r.ms, 0) / 1000).toFixed(1)} s`,
    ],
  ]

  document.getElementById('counts').replaceChildren(
    ...rows.map(([name, cell]) =>
      el(
        'tr',
        {},
        el('td', { class: 'pn-nowrap' }, name),
        ...setup.modes.map((m) => {
          const done = finished(m.id)
          return el('td', { class: 'num' }, done.length ? cell(done, m) : '…')
        }),
      ),
    ),
  )

  const all = setup.modes.flatMap((m) => finished(m.id))
  document.getElementById('total').textContent = all.length
    ? `${plural(all.length, 'run')} · ${usageText(sumUsage(all))} · ${all[0].provider} · ${all[0].model}`
    : ''
}

// ── The answers: per question, one row per note ────────────────────────

function callView(c) {
  let output = c.output
  try {
    output = prettyJson(JSON.parse(c.output))
  } catch {}

  const block = codeBlock(output, 'json')
  block.setAttribute('data-wrap', '')

  return el(
    'div',
    { class: 'pn-call' },
    el(
      'div',
      { class: 'pn-call-head' },
      el('code', { class: 'pn-call-name' }, c.name),
      el('code', {}, c.arguments),
    ),
    block,
  )
}

function stepsBlock(run) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, `Requests · ${run.steps.length}`),
    ),
    el(
      'ol',
      { class: 'pn-steps' },
      run.steps.map((s) =>
        el(
          'li',
          { class: 'mx-stack' },
          el(
            'div',
            { class: 'mx-spread' },
            el(
              'span',
              { class: 'mx-small' },
              `Request ${s.number} · ${s.calls.length ? plural(s.calls.length, 'tool call') : 'answer'}`,
            ),
            el('span', { class: 'mx-small mx-muted' }, usageText(s.usage)),
          ),
          s.calls.map(callView),
          requestResponse(s.request, s.response),
        ),
      ),
    ),
  )
}

function answerBody(modeId, q) {
  const r = results[modeId][q.id]
  if (!r) {
    return el('span', { class: 'mx-small mx-muted' }, 'Running…')
  }
  if (r.error) {
    return el('span', { class: 'mx-small mx-bad' }, r.error)
  }

  const given = r.answer ? r.answer[q.asks] : null
  const calls = r.toolCalls
    ? `${plural(r.toolCalls, 'tool call')}${r.fetched ? '' : ', not this issue'}`
    : 'No tool calls'

  return [
    el(
      'div',
      { class: 'pn-answer-head' },
      el('b', { class: VERDICT_CLASS[r.verdict] }, verdictLabel(r.verdict)),
      given
        ? el(
            'span',
            { class: 'mx-small' },
            `${q.asks === 'status' ? 'Status' : 'Assignee'} `,
            el('code', {}, given),
            r.answer.current ? null : ', said to be old',
          )
        : null,
      el('span', { class: 'mx-small mx-muted pn-calls' }, calls),
    ),
    r.end === 'step_limit'
      ? el(
          'p',
          { class: 'mx-small mx-muted' },
          `No answer: the agent used all ${setup.maxSteps} requests.`,
        )
      : el(
          'p',
          { class: 'pn-answer' },
          r.answer?.answer ?? 'No answer that matches the schema.',
        ),
    stepsBlock(r),
  ]
}

function questionBlock(q) {
  const { before, after } = issueOf(q)

  return el(
    'div',
    { class: 'pn-question' },
    el('p', { class: 'pn-question-text' }, q.text),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      'In the tracker on day 3: ',
      el('code', { class: 'pn-now' }, after[q.asks]),
      before[q.asks] === after[q.asks]
        ? '. Not changed since day 0.'
        : ['. In the copy: ', el('code', {}, before[q.asks]), '.'],
    ),
    el(
      'div',
      { class: 'pn-rows' },
      setup.modes.map((m) =>
        el(
          'div',
          { class: 'pn-row' },
          el('span', { class: 'pn-mode-name' }, m.label),
          el(
            'div',
            { class: 'pn-row-body', 'data-slot': `${m.id}-${q.id}` },
            answerBody(m.id, q),
          ),
        ),
      ),
    ),
  )
}

// Built once per batch; a row is replaced when its run ends, so open folds in other rows stay open.
function renderAnswers() {
  const rest = setup.questions.filter((q) => q.id !== SAMPLE)

  document.getElementById('sample-box').hidden = false
  document
    .getElementById('sample')
    .replaceChildren(
      questionBlock(setup.questions.find((q) => q.id === SAMPLE)),
    )

  document.getElementById('answers-box').hidden = false
  document.getElementById('answers-title').textContent =
    `The other ${rest.length} questions`
  document.getElementById('answers').replaceChildren(...rest.map(questionBlock))
}

// ── Running: every question in every mode, at most 4 at the same time ──

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }
  notice.replaceChildren()

  const id = ++batchId
  results = Object.fromEntries(
    setup.modes.map((m) => [
      m.id,
      Object.fromEntries(setup.questions.map((q) => [q.id, null])),
    ]),
  )
  renderResult()
  renderAnswers()

  // Question by question, so the modes fill at the same pace. The sample question goes first.
  const order = [...setup.questions].sort(
    (a, b) => (b.id === SAMPLE) - (a.id === SAMPLE),
  )
  const units = order.flatMap((q) =>
    setup.modes.map((m) => ({ mode: m.id, q })),
  )
  const input = picker.value()
  let next = 0
  const worker = async () => {
    while (next < units.length && id === batchId) {
      const unit = units[next++]
      let result
      try {
        result = await call('run', {
          ...input,
          mode: unit.mode,
          question: unit.q.id,
        })
      } catch (error) {
        if (error.missingKey) {
          showError(notice, error)
        }
        result = { error: error.message }
      }

      if (id !== batchId) {
        return
      }

      results[unit.mode][unit.q.id] = result
      renderResult()
      document
        .querySelector(`[data-slot="${unit.mode}-${unit.q.id}"]`)
        ?.replaceChildren(...[answerBody(unit.mode, unit.q)].flat())
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: 4 }, worker)),
  )
}

button.addEventListener('click', start)
