import {
  busy,
  call,
  codeBlock,
  debounce,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const defaults = await call('defaults')
const { limits } = defaults
const STORE = 'skill-selection:catalog'
const PREVIOUS = 'skill-selection:previous'
const OUTCOME = Object.fromEntries(defaults.outcomes.map((o) => [o.id, o]))
const RIGHT = new Set(['hit', 'correct-none'])
const WRONG = ['false-fire', 'wrong-skill', 'miss']

const notice = document.getElementById('notice')
const button = document.getElementById('go')
const empty = document.getElementById('empty')
const headline = document.getElementById('headline')
const table = document.getElementById('table')
const rows = document.getElementById('rows')
const meaning = document.getElementById('meaning')
const raw = document.getElementById('raw')
const ctxSelect = document.getElementById('ctx-request')
let repeats = 1
let batch = 0
// The batch on screen: the test requests it sent, and results[test][repeat]:
// null while it waits, { ok, run } or { ok: false, error }.
let shown = null

// ── Skills and test requests, kept in localStorage ─────────────────────

const copy = (value) => JSON.parse(JSON.stringify(value))
const count = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const short = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const listOf = (items) =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    if (Array.isArray(saved?.skills) && Array.isArray(saved?.tests)) {
      return saved
    }
  } catch {}

  return { skills: copy(defaults.skills), tests: copy(defaults.tests) }
}

let state = load()
const save = () => localStorage.setItem(STORE, JSON.stringify(state))

// Where the browser has no field-sizing, a field takes the height of its text.
const autoSize = CSS.supports('field-sizing', 'content')
  ? () => {}
  : (field) => {
      const fit = () => {
        field.style.height = 'auto'
        field.style.height = `${field.scrollHeight + 2}px`
      }
      field.addEventListener('input', fit)
      requestAnimationFrame(fit)
    }

function skillCard(skill, i) {
  const name = el('input', {
    class: 'mx-input mx-input--small ss-name',
    value: skill.name,
    spellcheck: 'false',
    'aria-label': `Skill ${i + 1} name`,
  })
  const description = el('textarea', {
    class: 'mx-textarea ss-desc',
    rows: '3',
    maxlength: String(limits.maxDescription),
    spellcheck: 'false',
    'aria-label': `Skill ${i + 1} description`,
  })
  description.value = skill.description
  autoSize(description)

  name.addEventListener('change', () => {
    const old = state.skills[i].name
    const next = name.value.trim()
    state.skills[i].name = next
    // Test requests that expect the old name follow the rename.
    for (const t of state.tests) {
      if (t.expected === old) {
        t.expected = next
      }
    }
    save()
    renderTests()
    catalogChanged()
  })

  description.addEventListener('input', () => {
    state.skills[i].description = description.value
    save()
    catalogChanged()
  })

  return el(
    'article',
    { class: 'ss-skill' },
    name,
    description,
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Body'),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          skill.body ? count(skill.body.split('\n').length, 'line') : 'empty',
        ),
      ),
      skill.body
        ? codeBlock(skill.body, 'markdown')
        : el('p', { class: 'mx-small mx-muted ss-pad' }, 'No body.'),
    ),
  )
}

function renderSkills() {
  document
    .getElementById('skills')
    .replaceChildren(...state.skills.map(skillCard))
}

// A name or a description changed: show the new instructions and token counts.
const catalogChanged = debounce(async () => {
  try {
    const { instructions } = await call('instructions', {
      skills: state.skills,
    })
    document
      .getElementById('instructions')
      .replaceChildren(codeBlock(instructions))
    document.getElementById('instructions-size').textContent = count(
      instructions.split('\n').length,
      'line',
    )
    notice.replaceChildren()
    await renderContext()
  } catch (error) {
    showError(notice, error)
  }
}, 300)

function expectedSelect(test, i) {
  const select = el(
    'select',
    {
      class: 'mx-select mx-input--small ss-expected',
      'aria-label': `Expected skill for request ${i + 1}`,
    },
    el('option', { value: '' }, 'none'),
    state.skills.map((s) => el('option', { value: s.name }, s.name)),
  )
  select.value = test.expected ?? ''

  select.addEventListener('change', () => {
    test.expected = select.value || null
    save()
    renderContext()
  })

  return select
}

function testRow(test, i) {
  const request = el('textarea', {
    class: 'mx-textarea ss-request',
    rows: '2',
    maxlength: String(limits.maxRequest),
    spellcheck: 'false',
    'aria-label': `Request ${i + 1}`,
  })
  request.value = test.request
  autoSize(request)

  request.addEventListener('input', () => {
    test.request = request.value
    save()
    renderContextOptions()
  })

  return el(
    'tr',
    {},
    el('td', { class: 'num' }, String(i + 1)),
    el('td', { class: 'ss-request-cell' }, request),
    el('td', {}, expectedSelect(test, i)),
    el(
      'td',
      {},
      el(
        'button',
        {
          type: 'button',
          class: 'mx-btn mx-btn--small ss-remove',
          title: 'Remove this request',
          'aria-label': `Remove request ${i + 1}`,
          disabled: state.tests.length <= 1,
          onclick: () => {
            state.tests.splice(i, 1)
            save()
            renderTests()
          },
        },
        '×',
      ),
    ),
  )
}

function renderTests() {
  document.getElementById('tests').replaceChildren(...state.tests.map(testRow))
  document.getElementById('add').disabled =
    state.tests.length >= limits.maxTests

  const n = state.tests.length * repeats
  button.textContent = `Run ${count(n, 'request')}`
  // 15 default requests cost about $0.001 with OpenAI's default model, so 30 stay under 1 cent.
  empty.textContent = `Press ${button.textContent}. ${count(n, 'small paid request')}${repeats > 1 ? `, each test request ${repeats} times` : ''}${n <= 30 ? ', under 1 cent in total' : ''}.`
  renderContextOptions()
}

// ── Results ────────────────────────────────────────────────────────────

function addUsage(total, u) {
  if (!total) {
    return { ...u }
  }

  return {
    inputTokens: total.inputTokens + u.inputTokens,
    outputTokens: total.outputTokens + u.outputTokens,
    reasoningTokens: total.reasoningTokens + u.reasoningTokens,
    cost: total.cost == null || u.cost == null ? null : total.cost + u.cost,
    costSource:
      total.cost == null || u.cost == null
        ? null
        : total.costSource === 'estimate' || u.costSource === 'estimate'
          ? 'estimate'
          : 'provider',
  }
}

const finished = () =>
  shown.results
    .flat()
    .filter((e) => e?.ok)
    .map((e) => e.run)

function outcomeButton(entry, i, r) {
  if (!entry) {
    return el('span', { class: 'mx-muted' }, 'waiting…')
  }
  if (!entry.ok) {
    return el('span', { class: 'mx-bad' }, entry.error)
  }

  const { outcome, incompleteReason } = entry.run
  return el(
    'button',
    {
      type: 'button',
      class: `ss-outcome ${RIGHT.has(outcome) ? 'mx-good' : 'mx-bad'}`,
      title: capital(OUTCOME[outcome].note),
      onclick: () => showRaw(i, r, true),
    },
    OUTCOME[outcome].label,
    incompleteReason ? ` (cut: ${incompleteReason})` : '',
  )
}

function resultRow(i) {
  const test = shown.tests[i]
  const entries = shown.results[i]

  return el(
    'tr',
    {},
    el('td', { class: 'num' }, String(i + 1)),
    el('td', { class: 'ss-request-text' }, test.request),
    el(
      'td',
      { class: 'ss-runs' },
      test.expected
        ? el('code', {}, test.expected)
        : el('span', { class: 'mx-muted' }, 'none'),
    ),
    el(
      'td',
      { class: 'ss-runs' },
      entries.map((e) =>
        el(
          'div',
          {},
          e?.ok && e.run.loaded.length
            ? el('code', {}, e.run.loaded.join(', '))
            : el('span', { class: 'mx-muted' }, e?.ok ? 'none' : '—'),
        ),
      ),
    ),
    el(
      'td',
      { class: 'ss-runs' },
      entries.map((e, r) => el('div', {}, outcomeButton(e, i, r))),
    ),
  )
}

// The answer, the request and the response of one result. A click on an outcome opens it.
function showRaw(i, r, open = false) {
  const { run } = shown.results[i][r]
  const n = shown.tests.length
  document.getElementById('raw-title').textContent =
    `request ${i + 1} of ${n}${repeats > 1 ? `, repeat ${r + 1}` : ''} · press an outcome in the table for another`

  document
    .getElementById('raw-body')
    .replaceChildren(
      run.loaded.length
        ? el(
            'p',
            {},
            `The model called load_skill with `,
            el('code', {}, run.loaded.join(', ')),
            '. The example stops here.',
          )
        : el(
            'div',
            { class: 'mx-stack' },
            el(
              'span',
              { class: 'mx-label' },
              'No skill loaded. The model answered',
            ),
            run.text.trim()
              ? modelText(run.text)
              : el('p', { class: 'mx-muted' }, '(no text)'),
          ),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `${capital(OUTCOME[run.outcome].label)}: ${OUTCOME[run.outcome].note}. ${usageText(run.usage)}`,
      ),
      requestResponse(run.request, run.response),
    )

  raw.hidden = false
  if (open) {
    raw.open = true
    raw.scrollIntoView({ block: 'nearest' })
  }
}

// The finding in plain words, from the scored outcomes of this run.
function renderHeadline(counts, change, failed) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const right = counts.hit + counts['correct-none']
  const wrong = WRONG.filter((o) => counts[o]).map((o) =>
    count(counts[o], OUTCOME[o].label, OUTCOME[o].plural),
  )

  // The skills whose name or description led to a wrong choice.
  const suspects = [
    ...new Set(
      finished()
        .filter((run) => !RIGHT.has(run.outcome))
        .flatMap((run) =>
          run.outcome === 'miss'
            ? [run.expected]
            : run.outcome === 'wrong-skill'
              ? [...run.loaded, run.expected]
              : run.loaded,
        ),
    ),
  ].sort()

  const first = wrong.length
    ? `The model chose wrong for ${total - right} of ${count(total, 'request')}: ${listOf(wrong)}.`
    : `The model chose correctly for ${total === 1 ? 'the request' : `all ${total} requests`}.`
  const second = change
    ? `Against the previous run: ${change}`
    : wrong.length
      ? `Check the ${suspects.length === 1 ? 'description' : 'descriptions'} of ${listOf(suspects)}.`
      : 'Each request loaded the expected skill, or no skill for a near miss.'
  const errors = failed
    ? ` ${count(failed, 'request')} failed and ${failed === 1 ? 'is' : 'are'} not counted.`
    : ''

  headline.replaceChildren(
    el(
      'div',
      { class: `mx-callout${wrong.length ? ' mx-callout--warn' : ''}` },
      el('p', {}, `${first}${errors} ${second}`),
    ),
  )
  headline.hidden = false
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  const blank = state.tests.findIndex((t) => !t.request.trim())
  if (blank >= 0) {
    return showError(
      notice,
      new Error(
        `Test request ${blank + 1} is empty. Write it or remove it in Advanced.`,
      ),
    )
  }

  try {
    // Checks the skills before any paid request.
    await call('instructions', { skills: state.skills })
  } catch (error) {
    return showError(notice, error)
  }

  notice.replaceChildren()
  const id = ++batch
  const skills = copy(state.skills)
  shown = {
    tests: copy(state.tests),
    results: state.tests.map(() => new Array(repeats).fill(null)),
  }
  const { tests, results } = shown
  const units = tests.flatMap((_, i) =>
    Array.from({ length: repeats }, (_, r) => [i, r]),
  )

  let done = 0
  empty.textContent = `Sending ${units.length} requests…`
  empty.hidden = false
  headline.hidden = true
  meaning.hidden = true
  raw.hidden = true
  raw.open = false
  rows.replaceChildren(...tests.map((_, i) => resultRow(i)))
  table.hidden = false

  // One request per test request and repeat, at most maxParallel at once. Each row fills in as its answer arrives.
  let next = 0
  let first = true
  async function worker() {
    while (next < units.length && id === batch) {
      const [i, r] = units[next++]
      try {
        const run = await call('run', {
          skills,
          request: tests[i].request,
          expected: tests[i].expected,
          ...picker.value(),
        })
        results[i][r] = {
          ok: true,
          run: { ...run, expected: tests[i].expected },
        }
      } catch (error) {
        results[i][r] = { ok: false, error: error.message }
        if (error.missingKey) {
          showError(notice, error)
        }
      }

      if (id !== batch) {
        return
      }

      rows.children[i]?.replaceWith(resultRow(i))
      empty.textContent = `Sending ${units.length} requests… ${++done} done.`
      if (first && results[i][r].ok) {
        first = false
        showRaw(i, r)
      }
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(
      Array.from(
        { length: Math.min(limits.maxParallel, units.length) },
        worker,
      ),
    ),
  )

  if (id !== batch) {
    return
  }
  empty.hidden = true

  // Score in api.ts, and compare with the previous run of this page.
  const runs = finished()
  if (!runs.length) {
    return
  }

  let previous = null
  try {
    previous = JSON.parse(localStorage.getItem(PREVIOUS) ?? 'null')
  } catch {}

  const { counts, change } = await call('score', {
    outcomes: runs.map((run) => run.outcome),
    previous,
  })
  localStorage.setItem(PREVIOUS, JSON.stringify(counts))
  renderHeadline(counts, change, units.length - runs.length)

  const total = runs.reduce((sum, run) => addUsage(sum, run.usage), null)
  meaning.textContent = `A wrong outcome points to a skill name or description that needs a clearer scope. ${runs[0].provider} · ${runs[0].model} · total ${usageText(total)}`
  meaning.hidden = false
}

// ── Context size per strategy ──────────────────────────────────────────

function renderContextOptions() {
  const current = ctxSelect.selectedIndex
  ctxSelect.replaceChildren(
    ...state.tests.map((t, i) =>
      el(
        'option',
        { value: String(i) },
        `${i + 1}. ${short(t.request.trim() || '(empty)', 70)}`,
      ),
    ),
  )

  ctxSelect.selectedIndex = Math.min(
    Math.max(0, current),
    state.tests.length - 1,
  )
}

async function renderContext() {
  const test = state.tests[Number(ctxSelect.value)] ?? state.tests[0]
  let strategies
  try {
    ;({ strategies } = await call('context', {
      skills: state.skills,
      expected: test?.expected ?? null,
    }))
  } catch (error) {
    return showError(notice, error)
  }

  const n = (v) => v.toLocaleString('en-US')
  document
    .getElementById('ctx-rows')
    .replaceChildren(
      ...strategies.map((s) =>
        el(
          'tr',
          {},
          el('td', {}, s.label),
          el('td', { class: 'num' }, n(s.upfront.tokens)),
          el(
            'td',
            { class: 'num' },
            s.loaded.tokens ? n(s.loaded.tokens) : '—',
          ),
          el('td', { class: 'num' }, n(s.upfront.tokens + s.loaded.tokens)),
        ),
      ),
    )

  document
    .getElementById('ctx-text')
    .replaceChildren(
      ...strategies.flatMap((s) =>
        [
          el('span', { class: 'mx-label' }, s.label),
          codeBlock(s.upfront.text),
          s.loaded.text
            ? el(
                'span',
                { class: 'mx-small mx-muted' },
                `Loads for this request (${test?.expected ?? 'none'}):`,
              )
            : null,
          s.loaded.text ? codeBlock(s.loaded.text, 'markdown') : null,
        ].filter(Boolean),
      ),
    )
}

// ── Start ──────────────────────────────────────────────────────────────

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const repeatSeg = document.getElementById('repeats')
repeatSeg.replaceChildren(
  ...Array.from({ length: limits.maxRuns }, (_, k) => k + 1).map((value) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(value === repeats),
        onclick: () => {
          repeats = value
          for (const b of repeatSeg.children) {
            b.setAttribute(
              'aria-pressed',
              String(b.textContent === String(value)),
            )
          }
          renderTests()
        },
      },
      String(value),
    ),
  ),
)

document.getElementById('add').addEventListener('click', () => {
  state.tests.push({ request: '', expected: null })
  save()
  renderTests()
  document
    .getElementById('tests')
    .lastElementChild?.querySelector('textarea')
    ?.focus()
})

document.getElementById('reset').addEventListener('click', () => {
  state = { skills: copy(defaults.skills), tests: copy(defaults.tests) }
  save()
  renderSkills()
  renderTests()
  catalogChanged()
})
ctxSelect.addEventListener('change', renderContext)
button.addEventListener('click', start)

renderSkills()
renderTests()
catalogChanged()
