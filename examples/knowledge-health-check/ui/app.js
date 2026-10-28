import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const setup = await call('setup')
const button = document.getElementById('run')
const notice = document.getElementById('notice')
const label = (kind) => setup.kindLabels[kind]
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const num = (n) => n.toLocaleString('en-US')
const meaningCount = setup.seeded.filter((s) => s.layer === 'model').length
const scriptCount = setup.seeded.length - meaningCount

let runs = 1
let effort = 'medium'
let batch = 0
// The script result, and one entry per run: { state: 'running' | 'done' | 'failed', review, error }.
let state = { script: null, runs: [] }

// ── The headline: readouts, one sentence, the seeded table ─────────────

function readout(name, value, sub) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, name),
    el('b', {}, value),
    sub ? el('span', { class: 'mx-small mx-muted' }, sub) : null,
  )
}

function sumUsage(list) {
  return list.reduce(
    (t, u) => ({
      inputTokens: t.inputTokens + u.inputTokens,
      outputTokens: t.outputTokens + u.outputTokens,
      reasoningTokens: t.reasoningTokens + u.reasoningTokens,
      cost: t.cost == null || u.cost == null ? null : t.cost + u.cost,
      costSource:
        t.costSource === 'estimate' || u.costSource === 'estimate'
          ? 'estimate'
          : u.costSource,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      costSource: null,
    },
  )
}

const doneRuns = () =>
  state.runs.filter((r) => r.state === 'done').map((r) => r.review)

function renderHeadline() {
  const reviews = doneRuns()
  const many = state.runs.length > 1
  // Per run, so the spread between runs shows: "3, 4, 3".
  const perRun = (pick) => (reviews.length ? reviews.map(pick).join(', ') : '…')
  const sum = (pick) => reviews.reduce((n, r) => n + pick(r), 0)
  const found = state.script.found.length
  const rejected = sum((r) => r.rejected)
  const fixes = sum((r) => r.findings.length)

  document.getElementById('verdict').replaceChildren(
    readout(
      'Script found',
      `${found} of ${scriptCount}`,
      `$0 · ${state.script.ms} ms`,
    ),
    readout(
      'Model found',
      `${perRun((r) => r.found.length)} of ${meaningCount}`,
      many ? 'per run' : null,
    ),
    readout(
      'False alarms',
      perRun((r) => r.falseAlarms),
      many ? 'per run' : null,
    ),
    readout(
      'Guard rejected',
      reviews.length ? `${rejected} of ${fixes}` : '…',
      many ? 'fixes, all runs' : 'fixes',
    ),
  )

  const total = sumUsage(reviews.map((r) => r.usage))
  document.getElementById('total').textContent = reviews.length
    ? `Model: ${plural(reviews.length, 'request')} · ${usageText(total)}`
    : ''

  // One sentence: what the numbers mean. The table under it shows each problem.
  const pending = state.runs.some((r) => r.state === 'running')
  let meaning = ''
  if (found !== scriptCount) {
    meaning =
      'The script missed a mechanical problem. Check the rules in check.ts.'
  } else if (!pending && reviews.length) {
    meaning = rejected
      ? 'The guard rejected each fix that breaks the wiki, before anything was saved.'
      : 'No fix broke a link or dropped a field, so the guard accepted every fix.'
  }
  document.getElementById('meaning').textContent = meaning

  document.getElementById('seeded').replaceChildren(
    ...setup.seeded.map((s) => {
      const k = reviews.filter((r) => r.found.includes(s.id)).length

      let by
      if (s.layer === 'script') {
        by = state.script.found.includes(s.id)
          ? el('span', { class: 'mx-good' }, 'Script')
          : el('span', { class: 'mx-bad' }, 'Missed')
      } else if (!reviews.length) {
        by = el('span', { class: 'mx-muted' }, pending ? 'waiting…' : '—')
      } else if (k) {
        by = el(
          'span',
          { class: 'mx-good' },
          `Model${many ? ` · ${k} of ${reviews.length} runs` : ''}`,
        )
      } else {
        by = el('span', { class: 'mx-bad' }, 'Missed')
      }

      return el(
        'tr',
        {},
        el('td', { class: 'hc-nowrap' }, label(s.kind)),
        el(
          'td',
          { class: 'hc-table-notes' },
          s.notes.map((n) => el('code', { class: 'hc-note' }, n)),
        ),
        el('td', { class: 'hc-about' }, s.about),
        el('td', { class: 'hc-nowrap' }, by),
      )
    }),
  )
}

// ── Step 1: the script's findings, in a fold under the table ───────────

function renderScript() {
  const { problems } = state.script
  document.getElementById('script-note').textContent = plural(
    problems.length,
    'problem',
  )

  document
    .getElementById('problems')
    .replaceChildren(
      ...problems.map((p) =>
        el(
          'li',
          {},
          el('span', { class: 'hc-kind' }, label(p.kind)),
          el('code', { class: 'hc-note' }, p.note),
          el('span', { class: 'mx-muted' }, p.text),
        ),
      ),
    )
}

// ── Steps 2 and 3: the findings of each run, with the guard's verdict ──

function editBlock(edit) {
  const head =
    edit.action === 'delete' ? `Delete ${edit.note}` : `Replace in ${edit.note}`
  const lines = (prefix, text) =>
    text
      .split('\n')
      .map((line) => `${prefix} ${line}`)
      .join('\n')
  const diff =
    edit.action === 'delete'
      ? `- (the whole note ${edit.note})`
      : `${lines('-', edit.find)}\n${lines('+', edit.replace)}`
  const block = codeBlock(diff, 'diff')
  block.setAttribute('data-wrap', '')

  return el(
    'div',
    { class: 'hc-edit' },
    el('span', { class: 'mx-small mx-muted' }, head),
    block,
  )
}

function matchTag(f) {
  if (!f.match) {
    return el(
      'span',
      {
        class: 'hc-tag hc-tag--alarm',
        title:
          'It matches no seeded problem. Read it: the wiki can have a problem that nobody seeded.',
      },
      'Not seeded',
    )
  }

  const seeded = setup.seeded.find((s) => s.id === f.match)
  return el(
    'span',
    { class: `hc-tag${f.repeat ? '' : ' hc-tag--hit'}` },
    f.repeat
      ? `Repeats: ${label(seeded.kind)}`
      : `Seeded: ${label(seeded.kind)}`,
  )
}

function findingCard(f) {
  const verdict = f.guard.accepted
    ? el(
        'p',
        { class: 'hc-verdict' },
        el('b', { class: 'mx-good' }, 'Guard: accepted'),
        el(
          'span',
          { class: 'mx-muted' },
          ' · the script finds no new problem in the copy.',
        ),
      )
    : el(
        'div',
        { class: 'hc-verdict' },
        el('b', { class: 'mx-bad' }, 'Guard: rejected'),
        el(
          'ul',
          {},
          f.guard.reasons.map((r) => el('li', {}, r)),
        ),
      )

  return el(
    'article',
    { class: `hc-finding${f.guard.accepted ? '' : ' is-rejected'}` },
    el(
      'div',
      { class: 'hc-finding-head' },
      el('b', {}, label(f.kind)),
      el(
        'span',
        { class: 'hc-notes-inline' },
        f.notes.map((n) => el('code', { class: 'hc-note' }, n)),
      ),
      matchTag(f),
    ),
    el(
      'blockquote',
      { class: 'hc-quote' },
      modelText(f.evidence, 'mx-output hc-small'),
    ),
    el(
      'div',
      { class: 'hc-fix' },
      el('span', { class: 'mx-label' }, 'Proposed fix'),
      modelText(f.fix.summary, 'mx-output hc-small'),
      f.fix.edits.map(editBlock),
    ),
    verdict,
    f.match
      ? null
      : el(
          'p',
          { class: 'mx-hint hc-alarm-note' },
          'This finding matches no seeded problem, so it counts as a false alarm. Read it: it can still be correct.',
        ),
  )
}

function runCard(run, i) {
  const many = state.runs.length > 1
  const head = many
    ? el(
        'div',
        { class: 'mx-spread' },
        el('span', { class: 'hc-run' }, `Run ${i + 1}`),
        el(
          'span',
          { class: 'mx-small mx-muted' },
          run.state === 'done'
            ? usageText(run.review.usage)
            : run.state === 'running'
              ? 'Waiting for the model…'
              : 'Failed',
        ),
      )
    : null

  if (run.state === 'running') {
    return el(
      'div',
      { class: 'mx-panel hc-runcard' },
      head ?? el('p', { class: 'mx-muted hc-pulse' }, 'Waiting for the model…'),
    )
  }

  if (run.state === 'failed') {
    return el(
      'div',
      { class: 'mx-panel hc-runcard' },
      head,
      el('p', { class: 'mx-bad mx-small' }, run.error.message),
    )
  }

  const r = run.review

  return el(
    'div',
    { class: 'mx-panel hc-runcard' },
    head,
    r.findings.length
      ? r.findings.map(findingCard)
      : el('p', { class: 'mx-muted' }, 'The model reported no problems.'),
    el(
      'details',
      { class: 'mx-details' },
      el(
        'summary',
        {},
        el(
          'span',
          { class: 'mx-label' },
          many ? `Request and response · run ${i + 1}` : 'Request and response',
        ),
        el(
          'span',
          { class: 'mx-muted mx-small' },
          `${r.model} · ${num(r.usage.inputTokens)} input tokens`,
        ),
      ),
      el('div', { class: 'hc-pad' }, requestResponse(r.request, r.response)),
    ),
  )
}

function renderRuns() {
  document.getElementById('review-box').hidden = false
  document
    .getElementById('runs-out')
    .replaceChildren(...state.runs.map(runCard))
}

function render() {
  renderHeadline()
  renderRuns()
}

// ── Running ────────────────────────────────────────────────────────────

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  const id = ++batch
  const input = { effort, ...picker.value() }
  state = {
    script: await call('script'),
    runs: Array.from({ length: runs }, () => ({ state: 'running' })),
  }

  document.getElementById('empty').hidden = true
  document.getElementById('result').hidden = false
  renderScript()
  render()

  await busy(button, 'Running…', () =>
    Promise.all(
      state.runs.map(async (run) => {
        try {
          run.review = await call('review', input)
          run.state = 'done'
        } catch (error) {
          run.state = 'failed'
          run.error = error
          showError(notice, error)
        }

        if (id === batch) {
          render()
        }
      }),
    ),
  )
}

function seg(container, values, current, onPick) {
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
        String(value),
      ),
    ),
  )
}

function renderEmpty() {
  document
    .getElementById('empty')
    .replaceChildren(
      'Press ',
      el('b', {}, 'Run the health check'),
      `. About ${plural(runs, 'request')}, under 1 cent${runs > 1 ? ' in total' : ''}. The script is free.`,
    )
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

document.getElementById('base-note').textContent =
  `${setup.notes.length} notes · ${setup.seeded.length} seeded problems · today is ${setup.today}`
document
  .getElementById('notes')
  .replaceChildren(
    ...setup.notes.map((n) =>
      el(
        'div',
        { class: 'hc-file' },
        el('span', { class: 'mx-small' }, el('code', {}, `${n.id}.md`)),
        codeBlock(n.source.trim(), 'md'),
      ),
    ),
  )
seg(
  document.getElementById('runs'),
  Array.from({ length: setup.maxRuns }, (_, i) => i + 1),
  runs,
  (v) => {
    runs = v
    renderEmpty()
  },
)
seg(document.getElementById('efforts'), setup.efforts, effort, (v) => {
  effort = v
})
renderEmpty()
button.addEventListener('click', start)
