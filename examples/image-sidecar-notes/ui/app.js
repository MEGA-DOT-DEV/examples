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

// One batch at a time: { intake: null | result | { error }, runs: { [modeId]: { [questionId]: run | { error } | null } } }.
let batch = null
let batchId = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const money = (usd, source) =>
  usd == null
    ? '…'
    : `${formatCost(usd)}${source === 'estimate' ? ' est.' : ''}`
const imageQuestions = setup.questions.filter((q) => q.image)
const imageFacts = imageQuestions.flatMap((q) => q.facts)
const runOf = (modeId, q) => batch?.runs[modeId][q.id]
const finished = (modeId, q) => {
  const r = runOf(modeId, q)
  return r && !r.error ? r : null
}

// ── Settings, and the reference folds under the results ────────────────

const figure = (image) =>
  el(
    'figure',
    { class: 'sc-figure' },
    el('img', {
      src: image.url,
      alt: image.title,
      width: String(image.width),
      height: String(image.height),
    }),
    el('figcaption', { class: 'sc-path' }, image.path),
  )

document
  .getElementById('mode-list')
  .replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'sc-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small mx-muted' }, m.about),
      ),
    ),
  )
document.getElementById('base-size').textContent =
  `${plural(setup.notes.length, 'note')} and ${plural(setup.images.length, 'image')}, the same in every mode`
document.getElementById('images').replaceChildren(...setup.images.map(figure))
document
  .getElementById('notes')
  .replaceChildren(
    ...setup.notes.map((n) =>
      el(
        'div',
        { class: 'mx-stack' },
        el('span', { class: 'sc-path' }, n.path),
        codeBlock(n.text, 'md'),
      ),
    ),
  )
document.getElementById('tools-size').textContent =
  `2 instructions · ${plural(setup.tools.length, 'tool')}`
document
  .getElementById('tools')
  .replaceChildren(
    el(
      'div',
      { class: 'mx-stack sc-pad' },
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Agent instructions. They are the same in every mode.',
      ),
      codeBlock(setup.instructions),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Tools. Grep only and Sidecar notes get the first three. View tool also gets ',
        el('code', {}, 'view_image'),
        '.',
      ),
      codeBlock(prettyJson(setup.tools), 'json'),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        'Intake instructions. Intake sends one request per image, with the image in the user message.',
      ),
      codeBlock(setup.sidecarInstructions),
    ),
  )

// A run takes about 3 requests: 15 to 21 for six questions with the default model (README).
const runCount = setup.modes.length * setup.questions.length
document.getElementById('empty').textContent =
  `Press Run all modes. About ${setup.images.length + runCount * 3} requests, under 1 cent.`

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── The headline: image facts per mode, and every question ─────────────

function covered(modeId, questions) {
  const done = questions.map((q) => finished(modeId, q)).filter(Boolean)

  return { n: done.reduce((s, r) => s + r.score.covered, 0), runs: done.length }
}

/** One sentence on what the readouts mean, without their numbers. Says so when this batch does not show the effect. */
function meaning() {
  const all = setup.modes.every(
    (m) => covered(m.id, imageQuestions).runs === imageQuestions.length,
  )
  if (!all) {
    return ''
  }

  const found = (id) => covered(id, imageQuestions).n
  const text = setup.questions.filter((q) => !q.image)
  const textOk = setup.modes.every(
    (m) =>
      covered(m.id, text).n === text.reduce((s, q) => s + q.facts.length, 0),
  )

  const first =
    found('grep') === 0
      ? 'Grep only finds no image fact. The notes name each image, but search skips it and read refuses it.'
      : 'Grep only names an image fact. Check that answer: it can be a guess.'
  const missed = setup.modes
    .filter((m) => m.id !== 'grep' && found(m.id) < imageFacts.length)
    .map((m) => m.label)
  const second = !missed.length
    ? ' Sidecar notes and the view tool find all of them.'
    : ` ${missed.join(' and ')} ${missed.length === 1 ? 'misses' : 'miss'} some. Agent runs vary, so run again to compare.`

  return `${first}${second}${textOk ? ' Every mode answers the text questions in full.' : ''}`
}

function renderResult() {
  document.getElementById('result').hidden = false

  document.getElementById('readouts').replaceChildren(
    ...setup.modes.map((m) => {
      const c = covered(m.id, imageQuestions)
      return el(
        'div',
        { class: 'mx-readout' },
        el('span', { class: 'mx-label' }, m.label),
        el(
          'b',
          {},
          c.runs === imageQuestions.length
            ? `${c.n} of ${imageFacts.length}`
            : '…',
        ),
      )
    }),
  )

  document.getElementById('meaning').textContent = meaning()

  document
    .getElementById('facts-head')
    .replaceChildren(
      el(
        'tr',
        {},
        el('th', {}, 'Question'),
        el('th', {}, 'Answer is in'),
        ...setup.modes.map((m) => el('th', { class: 'num' }, m.label)),
      ),
    )

  document.getElementById('facts').replaceChildren(
    ...setup.questions.map((q) =>
      el(
        'tr',
        {},
        el('td', {}, q.text),
        el(
          'td',
          { class: 'sc-path' },
          q.image ? el('span', { class: 'sc-image-tag' }, 'image') : null,
          q.source,
        ),
        ...setup.modes.map((m) => {
          const r = runOf(m.id, q)
          const cell = !r
            ? '…'
            : r.error
              ? el('span', { class: 'mx-bad' }, 'failed')
              : el(
                  'span',
                  {
                    class:
                      r.score.covered === r.score.total
                        ? 'mx-good'
                        : r.score.covered
                          ? ''
                          : 'mx-bad',
                  },
                  `${r.score.covered}/${r.score.total}`,
                )

          return el('td', { class: 'num' }, cell)
        }),
      ),
    ),
  )
}

// ── Cost: intake once against view on every image question ─────────────

function perImageQuestion(modeId) {
  const done = imageQuestions.map((q) => finished(modeId, q))
  if (done.some((r) => !r || r.usage.cost == null)) {
    return null
  }

  return done.reduce((s, r) => s + r.usage.cost, 0) / done.length
}

function renderCosts() {
  const intake = batch.intake && !batch.intake.error ? batch.intake : null
  document.getElementById('cost-box').hidden = false

  const source = intake?.usage.costSource
  const sidecar = perImageQuestion('sidecar')
  const view = perImageQuestion('view')
  const extra = sidecar == null || view == null ? null : view - sidecar
  // The same rule as costs() in agent.ts: within setup.sameCost of the sidecar run counts as the same cost.
  const breakEven =
    extra == null || !intake || intake.usage.cost == null
      ? undefined
      : extra > setup.sameCost * sidecar
        ? Math.ceil(intake.usage.cost / extra)
        : null

  const readout = (label, value) =>
    el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, label),
      el('b', {}, value),
    )

  document
    .getElementById('costs')
    .replaceChildren(
      readout(
        'Intake, once',
        intake
          ? money(intake.usage.cost, source)
          : batch.intake?.error
            ? 'failed'
            : '…',
      ),
      readout('Sidecar notes, per image question', money(sidecar, source)),
      readout('View tool, per image question', money(view, source)),
      readout(
        'Intake costs less after',
        breakEven === undefined
          ? '…'
          : breakEven === null
            ? 'never in this run'
            : plural(breakEven, 'image question'),
      ),
    )

  document.getElementById('cost-meaning').textContent =
    breakEven === undefined
      ? ''
      : breakEven === null
        ? 'The view tool does not cost more per question here. The images are small, and runs vary more than the difference. Intake still helps: a grep finds the sidecar note without the image name.'
        : `The view tool costs ${money(extra, source)} more per image question. The image stays in every later request of the run. A grep also finds the sidecar note without the image name.`
}

// ── The sidecars: what intake wrote, and grep before and after ──────────

function renderIntake() {
  const box = document.getElementById('intake-box')
  box.hidden = false

  const list = document.getElementById('sidecars')
  if (!batch.intake) {
    return list.replaceChildren(
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `Intake is running: ${plural(setup.images.length, 'vision request')}…`,
      ),
    )
  }
  if (batch.intake.error) {
    return list.replaceChildren(
      el(
        'p',
        { class: 'mx-small mx-bad' },
        `Intake failed: ${batch.intake.error}`,
      ),
    )
  }

  const done = batch.intake
  list.replaceChildren(
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `${plural(done.sidecars.length, 'request')} · ${usageText(done.usage)} · ${(done.ms / 1000).toFixed(1)} s · ${done.model}`,
    ),
    ...done.sidecars.map((s) => {
      const image = setup.images.find((i) => i.path === s.image)
      const question = imageQuestions.find((q) => q.source === s.image)

      return el(
        'article',
        { class: 'mx-panel sc-sidecar' },
        el(
          'div',
          { class: 'sc-sidecar-head' },
          figure(image),
          el(
            'div',
            { class: 'mx-stack' },
            el(
              'span',
              { class: 'sc-path' },
              `${s.path} · ${usageText(s.usage)}`,
            ),
            codeBlock(s.text, 'md'),
          ),
        ),
        el(
          'div',
          { class: 'mx-table-wrap' },
          el(
            'table',
            { class: 'mx-table' },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', {}, 'Image fact'),
                el('th', {}, 'Grep before intake'),
                el('th', {}, 'Grep after intake'),
              ),
            ),
            el(
              'tbody',
              {},
              question.facts.map((f) =>
                el(
                  'tr',
                  {},
                  el('td', {}, f.label),
                  el(
                    'td',
                    { class: 'sc-path' },
                    f.before.length
                      ? f.before.join(', ')
                      : el('span', { class: 'mx-bad' }, 'no file'),
                  ),
                  el(
                    'td',
                    { class: 'sc-path' },
                    done.found[f.id].length
                      ? el(
                          'span',
                          { class: 'mx-good' },
                          done.found[f.id].join(', '),
                        )
                      : el('span', { class: 'mx-bad' }, 'no file'),
                  ),
                ),
              ),
            ),
          ),
        ),
        el(
          'details',
          { class: 'mx-details' },
          el(
            'summary',
            {},
            el(
              'span',
              { class: 'mx-label' },
              `Request and response · intake of ${s.image.split('/').pop()}`,
            ),
          ),
          el(
            'div',
            { class: 'sc-pad' },
            requestResponse(s.request, s.response),
          ),
        ),
      )
    }),
  )
}

// ── Answers: one row per question, one card per mode, every answer open ──

function callView(c) {
  let output = c.output
  try {
    output = prettyJson(JSON.parse(c.output))
  } catch {}

  const block = codeBlock(output, 'json')
  block.setAttribute('data-wrap', '')

  return el(
    'div',
    { class: `sc-call${c.error ? ' is-error' : ''}` },
    el(
      'div',
      { class: 'sc-call-head' },
      el('code', { class: 'sc-call-name' }, c.name),
      el('code', {}, c.arguments),
    ),
    block,
  )
}

function stepsBlock(run) {
  const calls = run.steps.reduce((n, s) => n + s.calls.length, 0)

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
      { class: 'sc-steps' },
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
              { class: 'sc-pad' },
              requestResponse(s.request, s.response),
            ),
          ),
        ),
      ),
    ),
  )
}

/** Sidecars by name, the other files as a count: "a.png.md and 4 other files". */
function searchShown(paths) {
  const sidecars = paths.filter((p) => p.endsWith('.png.md'))
  const others = paths.length - sidecars.length

  return [
    ...sidecars,
    others ? plural(others, sidecars.length ? 'other file' : 'file') : null,
  ]
    .filter(Boolean)
    .join(' and ')
}

function reachText(r) {
  const parts = [
    r.read.length ? `read ${r.read.join(', ')}` : null,
    r.matched.length ? `search found ${searchShown(r.matched)}` : null,
    r.viewed.length ? `viewed ${r.viewed.join(', ')}` : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' · ') : 'used no file'
}

function runCard(m, q) {
  const r = runOf(m.id, q)
  const head = el(
    'div',
    { class: 'mx-spread' },
    el('span', { class: 'sc-run' }, m.label),
    !r
      ? el(
          'span',
          { class: 'mx-small mx-muted' },
          m.id === 'sidecar' && !batch.intake
            ? 'waiting for intake…'
            : 'running…',
        )
      : r.error
        ? el('span', { class: 'mx-small mx-bad' }, 'failed')
        : el(
            'b',
            {
              class:
                r.score.covered === r.score.total
                  ? 'mx-good'
                  : r.score.covered
                    ? ''
                    : 'mx-bad',
            },
            `${r.score.covered} of ${r.score.total} facts`,
          ),
  )

  if (!r) {
    return el('article', { class: 'mx-panel sc-card' }, head)
  }
  if (r.error) {
    return el(
      'article',
      { class: 'mx-panel sc-card' },
      head,
      el('p', { class: 'mx-small mx-bad' }, r.error),
    )
  }

  return el(
    'article',
    { class: 'mx-panel sc-card' },
    head,
    el(
      'ul',
      { class: 'sc-checks' },
      r.score.facts.map((f) =>
        el(
          'li',
          {},
          el(
            'span',
            { class: f.covered ? 'mx-good' : 'mx-bad', 'aria-hidden': 'true' },
            f.covered ? '✓' : '✗',
          ),
          el('span', { class: f.covered ? '' : 'mx-muted' }, f.label),
        ),
      ),
    ),
    r.end === 'step_limit'
      ? el(
          'p',
          { class: 'mx-small mx-bad' },
          `No answer. The agent used all ${setup.maxSteps} requests.`,
        )
      : modelText(r.answer || '(no text)', 'mx-output sc-answer'),
    el(
      'p',
      { class: 'mx-small mx-muted sc-reach' },
      `${reachText(r)} · ${usageText(r.usage)}`,
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
        { class: 'mx-stack' },
        el(
          'div',
          { class: 'sc-question' },
          el('b', {}, q.text),
          el(
            'span',
            { class: 'sc-path' },
            q.image ? el('span', { class: 'sc-image-tag' }, 'image') : null,
            q.source,
          ),
        ),
        el(
          'div',
          { class: 'sc-cards' },
          setup.modes.map((m) =>
            el('div', { 'data-slot': `${m.id}-${q.id}` }, runCard(m, q)),
          ),
        ),
      ),
    ),
  )
}

function renderCard(m, q) {
  document
    .querySelector(`[data-slot="${m.id}-${q.id}"]`)
    ?.replaceChildren(runCard(m, q))
}

// ── Running: intake and the other modes at once; the sidecar runs wait for intake ──

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true
  const id = ++batchId

  batch = {
    intake: null,
    runs: Object.fromEntries(
      setup.modes.map((m) => [
        m.id,
        Object.fromEntries(setup.questions.map((q) => [q.id, null])),
      ]),
    ),
  }

  renderResult()
  renderCosts()
  renderIntake()
  renderAnswers()

  const input = picker.value()

  const intakeDone = call('intake', input)
    .then(
      (result) => result,
      (error) => {
        if (error.missingKey) {
          showError(notice, error)
        }
        return { error: error.message }
      },
    )
    .then((result) => {
      if (id !== batchId) {
        return
      }

      batch.intake = result
      renderIntake()
      renderCosts()

      for (const q of setup.questions) {
        renderCard(
          setup.modes.find((m) => m.id === 'sidecar'),
          q,
        )
      }
    })

  // The sidecar runs go last, so the workers do not wait for intake while other runs could go.
  const units = setup.modes
    .flatMap((m) => setup.questions.map((q) => ({ m, q })))
    .sort((a, b) => Number(a.m.id === 'sidecar') - Number(b.m.id === 'sidecar'))

  let next = 0
  const worker = async () => {
    while (next < units.length && id === batchId) {
      const { m, q } = units[next++]
      let result

      try {
        if (m.id === 'sidecar') {
          await intakeDone
        }
        if (id !== batchId) {
          return
        }

        if (m.id === 'sidecar' && batch.intake.error) {
          throw new Error('No sidecar notes. Intake failed.')
        }

        const sidecars =
          m.id === 'sidecar'
            ? Object.fromEntries(
                batch.intake.sidecars.map((s) => [s.image, s.text]),
              )
            : undefined
        result = await call('run', {
          ...input,
          question: q.id,
          mode: m.id,
          sidecars,
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

      batch.runs[m.id][q.id] = result
      renderResult()
      renderCosts()
      renderCard(m, q)
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all([intakeDone, ...Array.from({ length: 4 }, worker)]),
  )
}

button.addEventListener('click', start)
