import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  prettyJson,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const notice = document.getElementById('notice')
const button = document.getElementById('go')

let runs = 1
// One batch at a time: { built, runs, results: { [questionId]: { grep: [], index: [] } }, verdict }.
let batch = null
let batchId = 0

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
const num = (value, digits = 0) =>
  Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
const costText = (usd, source) =>
  usd == null
    ? 'cost unknown'
    : `${formatCost(usd)}${source === 'estimate' ? ' est.' : ''}`
const finished = (questionId, modeId) =>
  batch.results[questionId][modeId].filter((r) => r && !r.error)
const modeRuns = (modeId) =>
  setup.questions.flatMap((q) => finished(q.id, modeId))
const factCount = setup.questions.reduce(
  (total, q) => total + q.facts.length,
  0,
)

/** What a list of runs took in all: the numbers the table and the verdict use. */
function sum(list) {
  return list.reduce(
    (t, r) => ({
      runs: t.runs + 1,
      found: t.found + r.score.found,
      possible: t.possible + r.score.total,
      read: t.read + r.read.length,
      requests: t.requests + r.steps.length,
      tokens: t.tokens + r.usage.totalTokens,
      cached: t.cached + r.usage.cachedTokens,
      cost:
        t.cost == null || r.usage.cost == null ? null : t.cost + r.usage.cost,
      costSource:
        t.costSource === 'estimate' || r.usage.costSource === 'estimate'
          ? 'estimate'
          : r.usage.costSource,
    }),
    {
      runs: 0,
      found: 0,
      possible: 0,
      read: 0,
      requests: 0,
      tokens: 0,
      cached: 0,
      cost: 0,
      costSource: null,
    },
  )
}

// ── Settings ───────────────────────────────────────────────────────────

function seg(container, values, label, current, onPick) {
  container.replaceChildren(
    ...values.map((value) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(value === current),
          onclick: (event) => {
            onPick(value)
            for (const b of container.children) {
              b.setAttribute('aria-pressed', String(b === event.currentTarget))
            }
          },
        },
        label(value),
      ),
    ),
  )
}

function renderEmpty() {
  const requests =
    setup.notes.length / setup.batchSize +
    setup.questions.length * setup.modes.length * runs * 2
  document.getElementById('empty').textContent =
    `Press Build the index and run. About ${requests} requests, under 1 cent with the default model.`
}

document.getElementById('note-count').textContent = String(setup.notes.length)
document.getElementById('question-count').textContent = String(
  setup.questions.length,
)
seg(
  document.getElementById('runs'),
  Array.from({ length: setup.maxRuns }, (_, i) => i + 1),
  String,
  runs,
  (value) => {
    runs = value
    renderEmpty()
  },
)
document.getElementById('notes-size').textContent =
  `${plural(setup.notes.length, 'note')} · ${num(setup.notesTokens)} tokens · the file names are dates`
document
  .getElementById('notes')
  .replaceChildren(
    codeBlock(
      setup.notes.map((n) => `## ${n.path}\n${n.text}`).join('\n\n'),
      'md',
    ),
  )
document.getElementById('key-size').textContent =
  `${plural(setup.questions.length, 'question')} · ${plural(factCount, 'fact')}`
document.getElementById('key').replaceChildren(
  el(
    'div',
    { class: 'mx-table-wrap si-flat' },
    el(
      'table',
      { class: 'mx-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Question'),
          el('th', {}, 'Answer note'),
          el('th', {}, 'Facts'),
        ),
      ),
      el(
        'tbody',
        {},
        setup.questions.map((q) =>
          el(
            'tr',
            {},
            el(
              'td',
              {},
              q.text,
              q.missingWords.length
                ? el(
                    'span',
                    { class: 'mx-hint si-other' },
                    `Its note does not use: ${q.missingWords.join(', ')}`,
                  )
                : null,
            ),
            el('td', { class: 'si-path' }, q.note),
            el('td', {}, q.facts.map((f) => f.label).join(' · ')),
          ),
        ),
      ),
    ),
  ),
)
const toolNames = new Set(
  setup.modes.flatMap((m) => m.tools.map((t) => t.name)),
)
document.getElementById('tools-size').textContent =
  `the same instructions in both modes · ${plural(toolNames.size, 'tool')}`
document
  .getElementById('tools')
  .replaceChildren(
    el(
      'div',
      { class: 'mx-stack si-pad' },
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Instructions. The index mode adds index.md under them.',
      ),
      codeBlock(setup.instructions),
      ...setup.modes.flatMap((m) => [
        el(
          'p',
          { class: 'mx-small mx-muted' },
          `Tools · ${m.label} mode: ${m.about}`,
        ),
        codeBlock(prettyJson(m.tools), 'json'),
      ]),
    ),
  )
renderEmpty()

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── The build: index.md and what it cost ──────────────────────────────

function renderBuild() {
  const built = batch.built
  document.getElementById('build').hidden = false

  const readout = (label, value) =>
    el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, label),
      el('b', {}, value),
    )
  document
    .getElementById('build-readouts')
    .replaceChildren(
      readout(
        'Build cost',
        built ? costText(built.usage.cost, built.usage.costSource) : '…',
      ),
      readout('Index tokens', built ? num(built.tokens) : '…'),
      readout('Tokens per note', built ? num(built.tokensPerNote, 1) : '…'),
    )

  const box = document.getElementById('index')
  const requests = document.getElementById('build-requests')
  if (!built) {
    box.replaceChildren(
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `The model reads the notes, ${setup.batchSize} at a time…`,
      ),
    )
    requests.hidden = true
    return
  }

  const block = codeBlock(built.text, 'md')
  block.classList.add('si-index')
  block.setAttribute('data-wrap', '')
  box.replaceChildren(
    block,
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `The notes themselves take ${num(setup.notesTokens / setup.notes.length, 1)} tokens per note. Build: ${plural(built.requests.length, 'request')} · ${num(built.ms / 1000, 1)} s · ${num(built.usage.inputTokens)} input tokens · ${num(built.usage.outputTokens)} output tokens.`,
    ),
  )

  requests.hidden = false
  document.getElementById('build-requests-label').textContent =
    `Build requests and responses · ${built.requests.length}`
  document
    .getElementById('build-requests-body')
    .replaceChildren(
      ...built.requests.map((r) =>
        el(
          'div',
          { class: 'mx-stack' },
          el(
            'span',
            { class: 'mx-small mx-muted' },
            `${r.notes[0]} to ${r.notes.at(-1)} · ${usageText(r.usage)}`,
          ),
          requestResponse(r.request, r.response),
        ),
      ),
    )
}

// ── The headline: facts found per mode, then per question ──────────────

/** What the numbers mean, without repeating the readouts. It follows this batch, so it holds when grep does as well. */
function meaning() {
  const [grep, index] = setup.modes.map((m) => sum(modeRuns(m.id)))
  if (!grep.runs || !index.runs) {
    return ''
  }

  const other = setup.questions.filter((q) => q.missingWords.length)
  const g = sum(other.flatMap((q) => finished(q.id, 'grep')))
  const i = sum(other.flatMap((q) => finished(q.id, 'index')))
  const words =
    g.possible && i.possible
      ? `On the ${plural(other.length, 'question')} whose note uses other words, grep found ${g.found} of ${g.possible} facts and the index found ${i.found} of ${i.possible}.`
      : ''

  // Grep runs that saw the answer note only as matched lines, and missed a fact that sits on another line.
  const partial = modeRuns('grep').filter(
    (r) => r.score.reach === 'grep line' && r.score.found < r.score.total,
  ).length
  const lines = partial
    ? `In ${plural(partial, 'grep run')}, the agent answered from the matched lines and did not open the note, so it missed a fact.`
    : ''

  return [words, lines].filter(Boolean).join(' ')
}

function cells(list) {
  if (!list.length) {
    return [
      el('td', { class: 'num' }, '…'),
      el('td', { class: 'num' }),
      el('td', { class: 'num' }),
      el('td', { class: 'num' }),
    ]
  }

  const t = sum(list)
  return [
    el(
      'td',
      { class: 'num' },
      el(
        'span',
        { class: t.found === t.possible ? 'mx-good' : t.found ? '' : 'mx-bad' },
        `${t.found}/${t.possible}`,
      ),
    ),
    el('td', { class: 'num' }, num(t.read / t.runs, 1)),
    el('td', { class: 'num' }, num(t.tokens / t.runs)),
    el(
      'td',
      { class: 'num' },
      t.cost == null ? '?' : formatCost(t.cost / t.runs),
    ),
  ]
}

function renderResult() {
  document.getElementById('verdict').hidden = false
  document.getElementById('readouts').replaceChildren(
    ...setup.modes.map((m) => {
      const t = sum(modeRuns(m.id))
      return el(
        'div',
        { class: 'mx-readout' },
        el('span', { class: 'mx-label' }, `Facts found · ${m.label}`),
        el('b', {}, t.runs ? `${t.found} of ${t.possible}` : '…'),
      )
    }),
  )

  document.getElementById('meaning').textContent = meaning()

  const sub = ['Facts', 'Notes read', 'Tokens', 'Cost']
  document
    .getElementById('table-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', { rowspan: '2' }, 'Question'),
        ...setup.modes.map((m) =>
          el('th', { colspan: '4', class: 'si-group' }, m.label),
        ),
      ),
      el(
        'tr',
        {},
        ...setup.modes.flatMap((m) =>
          sub.map((s, i) =>
            el('th', { class: `num${i === 0 ? ' si-group' : ''}` }, s),
          ),
        ),
      ),
    )

  const rows = setup.questions.map((q) =>
    el(
      'tr',
      {},
      el(
        'td',
        {},
        q.text,
        q.missingWords.length
          ? el(
              'span',
              { class: 'mx-hint si-other' },
              'its note uses other words',
            )
          : null,
      ),
      ...setup.modes.flatMap((m) => cells(finished(q.id, m.id))),
    ),
  )

  // The facts in all are in the readouts above, so this row shows only the averages.
  const all = el(
    'tr',
    { class: 'si-sum' },
    el('td', {}, 'All questions, average per run'),
    ...setup.modes.flatMap((m) => [
      el('td', { class: 'num' }),
      ...cells(modeRuns(m.id)).slice(1),
    ]),
  )
  document.getElementById('table-body').replaceChildren(...rows, all)

  const done = setup.modes.flatMap((m) => modeRuns(m.id))
  const t = sum(done)
  document.getElementById('total').textContent = done.length
    ? `The table shows notes read, tokens and cost per run. In all: ${plural(done.length, 'agent run')} · ${plural(t.requests, 'request')} · ${num(t.tokens)} tokens, ${num(t.cached)} of them cached · ${costText(t.cost, t.costSource)} · ${done[0].model}`
    : ''
}

// ── What the index costs: break-even and the projection ────────────────

function renderWorth() {
  const box = document.getElementById('worth')
  const v = batch.verdict
  box.hidden = !v
  if (!v) {
    return
  }

  const built = batch.built
  const est = built.usage.costSource === 'estimate' ? ' est.' : ''
  const index = sum(modeRuns('index'))
  const readout = (label, value) =>
    el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, label),
      el('b', {}, value),
    )
  const paysBack = v.cost?.questions ?? null
  const p = v.projection
  const priced =
    p.costPerQuestion == null
      ? ''
      : `: about ${formatCost(p.costPerQuestion)} at the input price${p.cachedCostPerQuestion == null ? '' : `, or ${formatCost(p.cachedCostPerQuestion)} if the provider caches it`}`
  const costLine =
    v.cost &&
    (v.cost.saving > 0
      ? `Per question, the index mode cost ${formatCost(v.cost.saving)}${est} less than grep. This saving pays for the build.`
      : `Per question, the index mode cost ${formatCost(-v.cost.saving)}${est} more than grep, so the build never pays back in cost.`)
  const tokenLine =
    v.tokens.saving > 0
      ? `In tokens, the index mode used ${num(v.tokens.saving)} fewer per question. The build used ${num(built.usage.totalTokens)}, so it pays back after ${plural(v.tokens.questions, 'question')}.`
      : `In tokens, the index mode used ${num(-v.tokens.saving)} more per question, so the build's ${num(built.usage.totalTokens)} tokens never pay back.`

  document
    .getElementById('worth-body')
    .replaceChildren(
      el(
        'div',
        { class: 'mx-stack' },
        el(
          'div',
          { class: 'mx-readouts' },
          readout(
            'Cost pays back after',
            v.cost
              ? paysBack === null
                ? 'never'
                : plural(paysBack, 'question')
              : 'cost unknown',
          ),
          readout(
            `index.md at ${num(p.notes)} notes`,
            `${num(p.indexTokens)} tokens`,
          ),
        ),
        el(
          'ul',
          { class: 'si-lines' },
          [
            costLine ? el('li', {}, costLine) : null,
            el('li', {}, tokenLine),
            el(
              'li',
              {},
              `Per question, ${num(index.cached / index.runs)} of the index mode's tokens were cached input. Cached input costs a fraction of the input price.`,
            ),
          ].filter(Boolean),
        ),
        el(
          'p',
          { class: 'mx-callout' },
          el('b', {}, 'A projection, not a run. '),
          `index.md goes into every request. At ${num(index.requests / index.runs, 1)} requests per question, one question carries ${num(p.tokensPerQuestion)} index tokens before the agent reads a note${priced}.${p.buildCost == null ? '' : ` The build would cost about ${formatCost(p.buildCost)}.`} Grep results stay at 10 notes or fewer, for any number of notes.`,
        ),
      ),
    )
}

// ── Answers: per question, both modes side by side, every answer open ──

function factList(score) {
  return el(
    'ul',
    { class: 'si-checks' },
    score.facts.map((f) =>
      el(
        'li',
        {},
        el(
          'span',
          { class: f.found ? 'mx-good' : 'mx-bad', 'aria-hidden': 'true' },
          f.found ? '✓' : '✗',
        ),
        el('span', { class: f.found ? '' : 'mx-muted' }, f.label),
      ),
    ),
  )
}

function callView(c) {
  let output = c.output
  try {
    output = prettyJson(JSON.parse(c.output))
  } catch {}

  const block = codeBlock(output, 'json')
  block.setAttribute('data-wrap', '')

  return el(
    'div',
    { class: `si-call${c.error ? ' is-error' : ''}` },
    el(
      'div',
      { class: 'si-call-head' },
      el('code', { class: 'si-call-name' }, c.name),
      el('code', {}, c.arguments),
    ),
    block,
  )
}

function stepsBlock(run) {
  const calls = run.steps.reduce((total, s) => total + s.calls.length, 0)

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Steps · ${plural(run.steps.length, 'request')} · ${plural(calls, 'tool call')}`,
      ),
    ),
    el(
      'ol',
      { class: 'si-steps' },
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
              `Request ${s.number} · ${s.calls.length ? plural(s.calls.length, 'tool call') : 'the answer'}`,
            ),
            el('span', { class: 'mx-small mx-muted' }, usageText(s.usage)),
          ),
          s.calls.map(callView),
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el(
                'span',
                { class: 'mx-label' },
                `Request and response · step ${s.number}`,
              ),
            ),
            el(
              'div',
              { class: 'si-pad' },
              requestResponse(s.request, s.response),
            ),
          ),
        ),
      ),
    ),
  )
}

const REACH = {
  read: 'read it',
  'grep line': 'saw it only as a grep line',
  missed: 'did not find it',
}

function runCard(questionId, modeId, i) {
  const r = batch.results[questionId][modeId][i]
  const mode = setup.modes.find((m) => m.id === modeId)
  const label = `${mode.label}${batch.runs > 1 ? ` · run ${i + 1}` : ''}`
  const head = el(
    'div',
    { class: 'mx-spread' },
    el('span', { class: 'si-run' }, label),
    !r
      ? el('span', { class: 'mx-small mx-muted' }, 'running…')
      : r.error
        ? el('span', { class: 'mx-small mx-bad' }, 'failed')
        : el(
            'b',
            { class: r.score.found === r.score.total ? 'mx-good' : '' },
            `${r.score.found} of ${r.score.total} facts`,
          ),
  )

  if (!r) {
    return el('article', { class: 'mx-panel si-card' }, head)
  }
  if (r.error) {
    return el(
      'article',
      { class: 'mx-panel si-card' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  const question = setup.questions.find((q) => q.id === questionId)
  return el(
    'article',
    { class: 'mx-panel si-card' },
    head,
    factList(r.score),
    r.end === 'step_limit'
      ? el(
          'p',
          { class: 'mx-small mx-bad' },
          `No answer. The agent reached the limit of ${setup.maxSteps} requests.`,
        )
      : modelText(r.answer || '(no text)', 'mx-output si-answer'),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `Notes read: ${r.read.join(', ') || 'none'}. The answer is in ${question.note}. The agent ${REACH[r.score.reach]}.`,
    ),
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${num(r.ms / 1000, 1)} s · ${usageText(r.usage)}`,
    ),
    stepsBlock(r),
  )
}

// Built once per batch; a card is replaced when its run ends, so open folds in other cards stay open.
function renderAnswers() {
  document.getElementById('answers-box').hidden = false
  document.getElementById('answers').replaceChildren(
    ...setup.questions.map((q) =>
      el(
        'section',
        { class: 'mx-stack si-question' },
        el('h3', { class: 'mx-h3' }, q.text),
        el(
          'div',
          { class: 'si-pair' },
          setup.modes.map((m) =>
            el(
              'div',
              { class: 'mx-stack' },
              batch.results[q.id][m.id].map((_, i) =>
                el(
                  'div',
                  { 'data-slot': `${q.id}-${m.id}-${i}` },
                  runCard(q.id, m.id, i),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

function renderCard(questionId, modeId, i) {
  document
    .querySelector(`[data-slot="${questionId}-${modeId}-${i}"]`)
    ?.replaceChildren(runCard(questionId, modeId, i))
}

// ── Running: build once, then every question × mode × run, 4 at a time ─

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true

  const id = ++batchId
  batch = {
    built: null,
    runs,
    verdict: null,
    results: Object.fromEntries(
      setup.questions.map((q) => [
        q.id,
        Object.fromEntries(
          setup.modes.map((m) => [m.id, new Array(runs).fill(null)]),
        ),
      ]),
    ),
  }

  for (const section of ['verdict', 'worth', 'answers-box']) {
    document.getElementById(section).hidden = true
  }

  renderBuild()
  const input = picker.value()

  await busy(button, 'Running…', async () => {
    try {
      batch.built = await call('build', input)
    } catch (error) {
      document.getElementById('build').hidden = true
      return showError(notice, error)
    }
    if (id !== batchId) {
      return
    }
    renderBuild()
    renderResult()
    renderAnswers()

    const units = []
    for (let i = 0; i < runs; i++) {
      for (const q of setup.questions) {
        for (const m of setup.modes) {
          units.push({ question: q.id, mode: m.id, i })
        }
      }
    }

    let next = 0
    const worker = async () => {
      while (next < units.length && id === batchId) {
        const unit = units[next++]
        let result
        try {
          result = await call('run', {
            ...input,
            question: unit.question,
            mode: unit.mode,
            index: unit.mode === 'index' ? batch.built.text : undefined,
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
        batch.results[unit.question][unit.mode][unit.i] = result
        renderResult()
        renderCard(unit.question, unit.mode, unit.i)
      }
    }

    await Promise.all(Array.from({ length: 4 }, worker))

    if (id !== batchId) {
      return
    }

    const [grep, index] = setup.modes.map((m) => sum(modeRuns(m.id)))
    if (!grep.runs || !index.runs) {
      return
    }

    const built = batch.built
    try {
      batch.verdict = await call('verdict', {
        provider: modeRuns('grep')[0].provider,
        model: modeRuns('grep')[0].model,
        build: {
          cost: built.usage.cost,
          tokens: built.usage.totalTokens,
          tokensPerNote: built.tokensPerNote,
          notes: built.lines.length,
        },
        grep: {
          runs: grep.runs,
          requests: grep.requests,
          tokens: grep.tokens,
          cost: grep.cost,
        },
        index: {
          runs: index.runs,
          requests: index.requests,
          tokens: index.tokens,
          cost: index.cost,
        },
      })
    } catch (error) {
      return showError(notice, error)
    }

    if (id === batchId) {
      renderWorth()
    }
  })
}

button.addEventListener('click', start)
