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
const FACTS = setup.facts.length
const PAIRS = setup.duplicates.length

let nights = setup.maxNights
let effort = setup.efforts[0]
// One batch at a time: { nights, results: { [modeId]: { nights: Night[], error, running } } }.
let batch = null
let batchId = 0

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// ── Settings ───────────────────────────────────────────────────────────

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
  document.getElementById('empty').textContent =
    `Press Run both modes. About ${plural(nights * setup.modes.length, 'request')}, under 2 cents.`
}

seg(
  document.getElementById('nights'),
  Array.from({ length: setup.maxNights }, (_, i) => i + 1),
  nights,
  (n) => {
    nights = n
    renderEmpty()
  },
)
seg(document.getElementById('efforts'), setup.efforts, effort, (e) => {
  effort = e
})
document
  .getElementById('mode-list')
  .replaceChildren(
    ...setup.modes.map((m) =>
      el(
        'div',
        { class: 'cr-mode' },
        el('b', {}, m.label),
        el('span', { class: 'mx-small mx-muted' }, m.about),
      ),
    ),
  )

const ids = Object.keys(setup.notes)
document.getElementById('facts-size').textContent =
  `${FACTS} values in ${new Set(setup.facts.map((f) => f.note)).size} notes`
document
  .getElementById('facts')
  .replaceChildren(
    ...setup.facts.map((f) =>
      el(
        'tr',
        {},
        el('td', {}, el('code', {}, f.value)),
        el('td', {}, f.label),
        el('td', { class: 'cr-id' }, f.note),
      ),
    ),
  )
document.getElementById('wiki-size').textContent =
  `${plural(ids.length, 'note')}, ${PAIRS} duplicate pairs`
document
  .getElementById('wiki')
  .replaceChildren(
    el(
      'p',
      { class: 'mx-small mx-muted' },
      `Duplicate pairs: ${setup.duplicates.map((d) => `${d.a} and ${d.b}`).join(', ')}.`,
    ),
    ...ids.map((id) =>
      el(
        'div',
        { class: 'mx-stack cr-note' },
        el('span', { class: 'cr-id' }, id),
        codeBlock(setup.notes[id].trim(), 'md'),
      ),
    ),
  )
document
  .getElementById('formats')
  .replaceChildren(
    ...setup.modes.flatMap((m) => [
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `${m.label}: instructions, then the JSON schema of the answer.`,
      ),
      codeBlock(m.instructions),
      codeBlock(prettyJson(m.schema), 'json'),
    ]),
  )
renderEmpty()

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// ── The headline and the per-night tables ──────────────────────────────

const lastOf = (modeId) => batch.results[modeId].nights.at(-1)

/** One sentence on what the readouts mean, without their numbers. Says so when this batch does not show the effect. */
function meaning() {
  const [rewrite, edits] = ['rewrite', 'edits'].map(lastOf)
  if (
    !rewrite ||
    !edits ||
    Object.values(batch.results).some((r) => r.running)
  ) {
    return ''
  }

  const rejected = batch.results.edits.nights.reduce(
    (n, x) => n + x.rejected,
    0,
  )
  const loss =
    rewrite.after.facts < FACTS
      ? 'The rewrites lost facts, and nothing stopped them: each night saved what the model returned.'
      : 'This time the rewrites kept every fact. A rewrite loses facts on single bad nights, so run again to compare.'
  const guard = rejected
    ? ' Code skipped the checked edits that would drop a fact, break a link or delete a note.'
    : ' The checked edits needed no skip: the model kept to the rules.'
  const failed = setup.modes
    .flatMap((m) => batch.results[m.id].nights)
    .filter((n) => n.error).length
  const failures = failed
    ? ` In both modes together, ${plural(failed, 'night')} failed and saved nothing.`
    : ''

  return loss + guard + failures
}

function cell(text, cls = '') {
  return el('td', { class: `num ${cls}` }, text)
}

function table(mode) {
  const r = batch.results[mode.id]
  const s = setup.start
  // Only the checked edits have edits to skip.
  const checked = mode.id === 'edits'
  const heads = [
    'Night',
    'Facts left',
    'Notes',
    'Deleted',
    'Broken links',
    'Duplicates left',
    checked ? 'Edits skipped' : null,
    'Cost',
  ].filter(Boolean)

  const rows = [
    el(
      'tr',
      { class: 'cr-start' },
      el('td', {}, 'Before'),
      cell(`${s.facts}/${FACTS}`),
      cell(String(s.notes)),
      cell(''),
      cell(String(s.brokenLinks.length)),
      cell(`${s.duplicates}/${PAIRS}`),
      checked ? cell('') : null,
      cell(''),
    ),
    ...r.nights.map((n) =>
      el(
        'tr',
        {},
        el(
          'td',
          { class: n.error ? 'mx-bad' : '' },
          n.error ? `${n.night} · failed` : String(n.night),
        ),
        cell(
          `${n.after.facts}/${FACTS}`,
          n.after.facts < FACTS ? 'mx-bad' : '',
        ),
        cell(String(n.after.notes)),
        cell(String(n.deleted.length), n.deleted.length ? 'mx-bad' : ''),
        cell(
          String(n.after.brokenLinks.length),
          n.after.brokenLinks.length ? 'mx-bad' : '',
        ),
        cell(`${n.after.duplicates}/${PAIRS}`),
        checked
          ? cell(n.error ? '–' : `${n.rejected} of ${n.ops.length}`)
          : null,
        cell(
          n.usage.cost == null
            ? '?'
            : `${formatCost(n.usage.cost)}${n.usage.costSource === 'estimate' ? ' est.' : ''}`,
        ),
      ),
    ),
  ]

  const span = String(heads.length)
  if (r.running) {
    rows.push(
      el(
        'tr',
        {},
        el(
          'td',
          { colspan: span, class: 'mx-muted' },
          `Night ${r.nights.length + 1} running…`,
        ),
      ),
    )
  }

  if (r.error) {
    rows.push(
      el(
        'tr',
        {},
        el(
          'td',
          { colspan: span, class: 'mx-bad' },
          `Stopped at night ${r.nights.length + 1}: ${r.error}`,
        ),
      ),
    )
  }

  return el(
    'section',
    { class: 'mx-stack' },
    el('h3', { class: 'mx-h3' }, mode.label),
    el(
      'div',
      { class: 'mx-table-wrap' },
      el(
        'table',
        { class: 'mx-table cr-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            ...heads.map((h, i) => el('th', { class: i ? 'num' : '' }, h)),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
    ),
  )
}

function renderResult() {
  document.getElementById('result').hidden = false

  const rewrite = lastOf('rewrite')
  const edits = lastOf('edits')
  const facts = (last) => (last ? `${last.after.facts} of ${FACTS}` : '…')
  const deleted = batch.results.rewrite.nights.reduce(
    (n, x) => n + x.deleted.length,
    0,
  )
  const ops = batch.results.edits.nights.reduce(
    (t, x) => ({ all: t.all + x.ops.length, skipped: t.skipped + x.rejected }),
    { all: 0, skipped: 0 },
  )
  const readout = (label, value, bad = false) =>
    el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, label),
      el('b', { class: bad ? 'mx-bad' : '' }, value),
    )

  document
    .getElementById('readouts')
    .replaceChildren(
      readout(
        'Rewrite: facts left',
        facts(rewrite),
        rewrite && rewrite.after.facts < FACTS,
      ),
      readout(
        'Checked edits: facts left',
        facts(edits),
        edits && edits.after.facts < FACTS,
      ),
      readout(
        'Rewrite: notes deleted',
        rewrite ? String(deleted) : '…',
        deleted > 0,
      ),
      readout(
        'Checked edits: edits skipped',
        edits ? `${ops.skipped} of ${ops.all}` : '…',
      ),
    )

  document.getElementById('meaning').textContent = meaning()
  document.getElementById('tables').replaceChildren(...setup.modes.map(table))

  const all = setup.modes.flatMap((m) => batch.results[m.id].nights)
  const usage = all.reduce(
    (t, n) => ({
      inputTokens: t.inputTokens + n.usage.inputTokens,
      outputTokens: t.outputTokens + n.usage.outputTokens,
      reasoningTokens: t.reasoningTokens + n.usage.reasoningTokens,
      // A request that failed without an answer has no usage; the total leaves it out and says so.
      cost: t.cost + (n.usage.cost ?? 0),
      costSource:
        t.costSource === 'estimate' || n.usage.costSource === 'estimate'
          ? 'estimate'
          : n.usage.costSource,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cost: 0,
      costSource: null,
    },
  )
  const seconds = all.reduce((t, n) => t + n.ms, 0) / 1000
  const unknown = all.filter((n) => n.usage.cost == null).length

  document.getElementById('total').textContent = all.length
    ? `${plural(all.length, 'request')} · ${usageText(usage)}${unknown ? ` + ${unknown} failed without a cost` : ''} · ${seconds.toFixed(1)} s of requests · ${all[0].model}`
    : ''
}

// ── Night cards: what each night did, per mode ─────────────────────────

/** A line diff of two short texts: the longest common run of lines stays, the rest is removed or added. */
function lineDiff(before, after) {
  const a = before ? before.trimEnd().split('\n') : []
  const b = after ? after.trimEnd().split('\n') : []
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  )

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const lines = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push([' ', a[i]])
      i++
      j++
    } else if (
      i < a.length &&
      (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])
    ) {
      lines.push(['-', a[i++]])
    } else {
      lines.push(['+', b[j++]])
    }
  }

  return el(
    'pre',
    { class: 'cr-diff' },
    lines.map(([sign, text]) =>
      el(
        'span',
        { class: sign === '+' ? 'is-add' : sign === '-' ? 'is-del' : '' },
        `${sign} ${text}\n`,
      ),
    ),
  )
}

const KIND = { changed: 'changed', created: 'new note', deleted: 'deleted' }

function changesBlock(n) {
  if (!n.changes.length) {
    return null
  }

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Changed notes'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(n.changes.length, 'note')}, line diff`,
      ),
    ),
    el(
      'div',
      { class: 'mx-stack cr-pad' },
      n.changes.map((c) =>
        el(
          'div',
          { class: 'mx-stack cr-change' },
          el('span', { class: 'cr-id' }, `${c.id} · ${KIND[c.kind]}`),
          lineDiff(c.before, c.after),
        ),
      ),
    ),
  )
}

function opsBlock(n) {
  if (!n.ops.length) {
    return null
  }

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'All edits'),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${plural(n.ops.length, 'edit')}, ${n.rejected} skipped`,
      ),
    ),
    el(
      'ol',
      { class: 'cr-ops cr-pad' },
      n.ops.map((o) =>
        el(
          'li',
          { class: o.accepted ? '' : 'is-skip' },
          el(
            'code',
            {},
            `${o.op} ${o.note}${o.target ? ` → ${o.target}` : ''}`,
          ),
          o.accepted ? null : el('span', { class: 'mx-bad' }, ` ${o.reason}`),
        ),
      ),
    ),
  )
}

function nightCard(mode, i) {
  const r = batch.results[mode.id]
  const n = r.nights[i]
  if (!n) {
    const failed = r.error && i === r.nights.length
    return el(
      'article',
      { class: 'mx-panel cr-card' },
      el(
        'div',
        { class: 'mx-spread' },
        el('b', { class: 'cr-run' }, mode.label),
        el(
          'span',
          { class: `mx-small ${failed ? 'mx-bad' : 'mx-muted'}` },
          failed
            ? 'failed'
            : r.error
              ? 'not run'
              : r.running && i === r.nights.length
                ? 'running…'
                : 'waiting',
        ),
      ),
    )
  }

  const head = el(
    'div',
    { class: 'mx-spread' },
    el('b', { class: 'cr-run' }, mode.label),
    el(
      'b',
      { class: `cr-score ${n.lost.length ? 'mx-bad' : ''}` },
      `${n.after.facts} of ${FACTS} facts`,
    ),
  )
  const raw = el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
      el('span', { class: 'mx-small mx-muted' }, `night ${n.night}`),
    ),
    el('div', { class: 'cr-pad' }, requestResponse(n.request, n.response)),
  )

  if (n.error) {
    return el(
      'article',
      { class: 'mx-panel cr-card' },
      head,
      el(
        'p',
        { class: 'mx-small mx-bad' },
        `Failed: ${n.error} Nothing was saved. The next night starts from the same wiki.`,
      ),
      raw,
    )
  }

  const skipped = n.ops.filter((o) => !o.accepted)
  return el(
    'article',
    { class: 'mx-panel cr-card' },
    head,
    n.lost.length
      ? el(
          'ul',
          { class: 'cr-lost' },
          n.lost.map((f) =>
            el(
              'li',
              {},
              el('span', { class: 'mx-bad', 'aria-hidden': 'true' }, '✗'),
              el(
                'span',
                {},
                el('code', {}, f.value),
                ` ${f.label.toLowerCase()}, from ${f.note}`,
              ),
            ),
          ),
        )
      : el('p', { class: 'mx-small mx-muted' }, 'No fact lost.'),
    n.deleted.length
      ? el('p', { class: 'mx-small' }, `Deleted: ${n.deleted.join(', ')}`)
      : null,
    n.after.brokenLinks.length
      ? el(
          'p',
          { class: 'mx-small mx-bad' },
          `Broken links: ${n.after.brokenLinks.map((b) => `${b.note} → [[${b.target}]]`).join(', ')}`,
        )
      : null,
    skipped.length
      ? el(
          'ul',
          { class: 'cr-skips' },
          skipped.map((o) =>
            el(
              'li',
              {},
              el(
                'code',
                {},
                `${o.op} ${o.note}${o.target ? ` → ${o.target}` : ''}`,
              ),
              el('span', { class: 'mx-small' }, o.reason),
            ),
          ),
        )
      : null,
    !n.changes.length
      ? el('p', { class: 'mx-small mx-muted' }, 'No note changed.')
      : null,
    changesBlock(n),
    opsBlock(n),
    raw,
  )
}

// Built once per batch; a card is replaced when its night ends, so open folds elsewhere stay open.
function renderNights() {
  document.getElementById('nights-box').hidden = false
  document
    .getElementById('night-cards')
    .replaceChildren(
      ...Array.from({ length: batch.nights }, (_, i) =>
        el(
          'div',
          { class: 'cr-night' },
          el('h3', { class: 'mx-h3 cr-night-head' }, `Night ${i + 1}`),
          ...setup.modes.map((m) =>
            el('div', { 'data-slot': `${m.id}-${i}` }, nightCard(m, i)),
          ),
        ),
      ),
    )
}

function renderCard(mode, i) {
  document
    .querySelector(`[data-slot="${mode.id}-${i}"]`)
    ?.replaceChildren(nightCard(mode, i))
}

// ── Running: both modes at the same time, the nights of a mode in order ─

async function runChain(mode, id, input) {
  const r = batch.results[mode.id]
  let wiki = setup.notes

  for (let i = 0; i < batch.nights; i++) {
    let night
    try {
      night = await call('night', {
        ...input,
        mode: mode.id,
        night: i + 1,
        wiki,
      })
    } catch (error) {
      if (id !== batchId) {
        return
      }
      if (error.missingKey) {
        showError(notice, error)
      }
      r.error = error.message
      break
    }

    if (id !== batchId) {
      return
    }

    r.nights.push(night)
    wiki = night.wiki
    renderResult()
    renderCard(mode, i)
    renderCard(mode, i + 1)
  }

  r.running = false
  renderResult()
  for (let i = r.nights.length; i < batch.nights; i++) {
    renderCard(mode, i)
  }
}

async function start() {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true

  const id = ++batchId
  batch = {
    nights,
    results: Object.fromEntries(
      setup.modes.map((m) => [
        m.id,
        { nights: [], error: null, running: true },
      ]),
    ),
  }

  renderResult()
  renderNights()

  const input = { effort, ...picker.value() }
  await busy(button, 'Running…', () =>
    Promise.all(setup.modes.map((m) => runChain(m, id, input))),
  )
}

button.addEventListener('click', start)
