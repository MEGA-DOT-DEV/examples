import {
  busy,
  call,
  el,
  formatCost,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const picker = await providerPicker(document.getElementById('picker'))
const notice = document.getElementById('notice')
const button = document.getElementById('run')
const verdict = document.getElementById('verdict')
const readouts = document.getElementById('readouts')
const tableBox = document.getElementById('table-box')
const rows = document.getElementById('rows')
const versions = document.getElementById('versions')
const empty = document.getElementById('empty')
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const versionName = (v) =>
  v.number === 0
    ? 'Version 0 · start prompt'
    : `Version ${v.number} · rewrite ${v.number}`
const costText = (usage) =>
  `${formatCost(usage.cost)}${usage.costSource === 'estimate' ? ' est.' : ''}`

function change(delta) {
  if (delta === 0) {
    return 'did not change'
  }

  return `${delta > 0 ? 'rose' : 'fell'} by ${plural(Math.abs(delta), 'case')}`
}

/** The point of the run in plain words: did the rewrites help on new cases too? */
function verdictText(report) {
  const first = report.versions[0]
  const last = report.versions.at(-1)
  const training = last.training.correct - first.training.correct
  const heldOut = last.heldOut.correct - first.heldOut.correct
  const growth = last.promptLength / first.promptLength

  const meaning =
    heldOut > 0
      ? 'The rewrites also helped on cases the rewriter never saw.'
      : heldOut < 0
        ? 'The rewrites made new cases worse.'
        : first.heldOut.correct === first.heldOut.total
          ? 'Version 0 already got every held-out case right, so the rewrites had nothing to gain there.'
          : training > 0
            ? 'The rewrites fit the training cases but did not help on new cases.'
            : 'The rewrites did not help.'
  const length =
    growth >= 1.5 ? ` The prompt is ${growth.toFixed(1)}× longer.` : ''

  return `From version 0 to version ${last.number}, the training score ${change(training)} and the held-out score ${change(heldOut)}. ${meaning}${length}`
}

function readout(label, value) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, value),
  )
}

/** A score cell, marked when it is better or worse than the version before. */
function scoreCell(totals, previous) {
  const mark =
    previous == null
      ? null
      : totals.correct > previous.correct
        ? 'mx-good'
        : totals.correct < previous.correct
          ? 'mx-bad'
          : null

  return el(
    'td',
    { class: `num${mark ? ` ${mark}` : ''}` },
    `${totals.correct} / ${totals.total}`,
  )
}

function row(version, previous) {
  return el(
    'tr',
    {},
    el('td', {}, versionName(version)),
    scoreCell(version.training, previous?.training),
    scoreCell(version.heldOut, previous?.heldOut),
    el(
      'td',
      { class: 'num' },
      `${version.promptLength.toLocaleString('en-US')} characters`,
    ),
    el('td', { class: 'num' }, costText(version.usage)),
  )
}

function failuresView(failures) {
  if (!failures.length) {
    return el('p', { class: 'mx-small' }, 'No training failures.')
  }

  return el(
    'ul',
    { class: 'pe-failures mx-small' },
    ...failures.map((f) =>
      el(
        'li',
        {},
        `${f.id}: "${f.message}" Expected `,
        el('code', {}, f.expected),
        ', got ',
        el('code', {}, f.actual),
        '.',
      ),
    ),
  )
}

// Prompts and failure lists grow with each rewrite, so every version folds the same way.
function versionView(version) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, versionName(version)),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `prompt, ${version.failures.length ? plural(version.failures.length, 'training failure') : 'no training failures'}, requests`,
      ),
    ),
    el(
      'div',
      { class: 'mx-stack pe-version' },
      el('span', { class: 'mx-label' }, 'Prompt'),
      el('pre', { class: 'pe-prompt' }, version.prompt),
      el('span', { class: 'mx-label' }, 'Training failures'),
      failuresView(version.failures),
      el(
        'span',
        { class: 'mx-label' },
        'Request and response · training case T01',
      ),
      requestResponse(version.sampleRequest, version.sampleResponse),
      version.rewriteRequest
        ? el(
            'span',
            { class: 'mx-label' },
            `Request and response · rewrite ${version.number}`,
          )
        : null,
      version.rewriteRequest
        ? requestResponse(version.rewriteRequest, version.rewriteResponse)
        : null,
    ),
  )
}

function render(report) {
  verdict.textContent = verdictText(report)

  readouts.replaceChildren(
    readout('Model', report.model),
    readout('Requests', String(report.requests)),
    readout(
      report.usage.costSource === 'estimate' ? 'Cost (est.)' : 'Cost',
      formatCost(report.usage.cost),
    ),
  )

  rows.replaceChildren(
    ...report.versions.map((v, i) => row(v, report.versions[i - 1])),
  )
  versions.replaceChildren(...report.versions.map(versionView))

  for (const node of [verdict, readouts, tableBox]) {
    node.hidden = false
  }
}

button.addEventListener('click', () =>
  busy(button, 'Running… about 1 minute', async () => {
    if (!picker.hasKey()) {
      return missingKeyNote(notice)
    }

    showError(notice, null)
    try {
      render(await call('run', picker.value()))
      empty.hidden = true
    } catch (error) {
      showError(notice, error)
      for (const node of [verdict, readouts, tableBox]) {
        node.hidden = true
      }
      versions.replaceChildren()
      empty.hidden = false
      empty.textContent =
        'The run stopped. It shows no partial scores. Press Run to try again.'
    }
  }),
)
