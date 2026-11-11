import {
  call,
  codeBlock,
  el,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const button = document.getElementById('run')
const results = document.getElementById('results')
const meaning = document.getElementById('meaning')
const total = document.getElementById('total')
const readouts = document.getElementById('readouts')
const picker = await providerPicker(document.getElementById('picker'))
const modeLabels = {
  'no map': 'No map',
  'code map': 'Code map',
  'feature map': 'Feature map',
}

function yesNo(label, yes) {
  return el(
    'div',
    { class: 'map-check' },
    el('span', {}, label),
    el('strong', { class: yes ? 'mx-good' : 'mx-muted' }, yes ? 'Yes' : 'No'),
  )
}

function diff(change) {
  const lines = [
    `--- ${change.path} (before)`,
    `+++ ${change.path} (after)`,
    ...change.before
      .trimEnd()
      .split('\n')
      .map((line) => `- ${line}`),
    ...change.after
      .trimEnd()
      .split('\n')
      .map((line) => `+ ${line}`),
  ]
  return codeBlock(lines.join('\n'), 'diff')
}

function card(row, trial, maxSteps) {
  const files = row.changes.map((change) => change.path).join(', ') || 'none'
  const played = row.replay.played.join(' → ') || row.replay.error
  const repeats = row.replay.repeats
  const repeatText = `${repeats} ${repeats === 1 ? 'repeat' : 'repeats'}`
  const status = {
    pass: 'Pass',
    fail: 'Fail',
    unfinished: 'Did not finish',
  }[row.outcome]
  return el(
    'article',
    { class: 'mx-plate map-card' },
    el(
      'div',
      { class: 'map-card-head' },
      el('h3', { class: 'mx-h3' }, modeLabels[row.mode]),
      el('span', { class: 'mx-muted' }, `Trial ${trial}`),
    ),
    el(
      'div',
      {
        class: `map-headline ${row.outcome === 'pass' ? 'mx-good' : 'mx-bad'}`,
      },
      status,
    ),
    el('p', {}, `Steps used: ${row.steps} of ${maxSteps}`),
    el(
      'p',
      { class: 'mx-small' },
      `${repeatText} · ${played || 'No tracks played.'}`,
    ),
    workDetail(row),
    answerDetail(row),
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, `Changed files · ${row.changes.length}: ${files}`),
      ...row.changes.map(diff),
    ),
    stepsDetail(row),
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, `Requests and responses · ${row.traffic.length} pairs`),
      ...row.traffic.map((entry, index) =>
        el(
          'details',
          { class: 'mx-details' },
          el('summary', {}, `Request and response · step ${index + 1}`),
          requestResponse(entry.request, entry.response),
        ),
      ),
    ),
  )
}

function workDetail(row) {
  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      `How the agent worked · ${row.mode === 'feature map' ? 3 : 2} checks`,
    ),
    el(
      'div',
      { class: 'map-checks' },
      yesNo('Opened queue', row.openedQueue),
      yesNo('Ran the bug scenario', row.ranVerify),
      ...(row.mode === 'feature map'
        ? [yesNo('Left a note for the next agent', row.addedKeepInMind)]
        : []),
    ),
    el(
      'p',
      { class: 'mx-muted mx-small' },
      `${row.filesRead.length} file reads · ${usageText(row.usage)}`,
    ),
  )
}

function answerDetail(row) {
  return el(
    'details',
    { class: 'mx-details' },
    el('summary', {}, row.answer ? 'Agent’s final answer' : 'No final answer'),
    modelText(
      row.answer || 'The agent ran out of requests before it answered.',
    ),
  )
}

function stepsDetail(row) {
  const actions = row.actions.map(
    (action, index) =>
      `${index + 1}. ${action.name} ${action.target}` +
      (action.replay ? ` → ${JSON.stringify(action.replay)}` : ''),
  )

  return el(
    'details',
    { class: 'mx-details' },
    el('summary', {}, `Exploration · ${row.actions.length} tool calls`),
    codeBlock(row.filesRead.join('\n') || '(no files read)', 'text'),
    codeBlock(actions.join('\n') || '(no tool calls)', 'text'),
  )
}

function readout(mode, rows) {
  const finished = rows.filter(
    (row) => row.mode === mode && row.outcome === 'pass',
  ).length
  const total = rows.filter((row) => row.mode === mode).length
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, modeLabels[mode]),
    el('b', {}, `${finished} of ${total}`),
    el('span', {}, 'finished with a working fix'),
  )
}

button.addEventListener('click', async () => {
  showError(notice, null)
  button.disabled = true
  button.textContent = 'Running agents…'
  meaning.textContent = 'Agents are editing independent copies of the same app…'
  readouts.replaceChildren()
  readouts.hidden = true
  results.replaceChildren()

  try {
    const mode = document.getElementById('mode').value || undefined
    const runs = Number(document.getElementById('runs').value)
    const comparison = await call('run', { mode, runs, ...picker.value() })
    const trialByMode = {}
    results.replaceChildren(
      ...comparison.rows.map((row) => {
        trialByMode[row.mode] = (trialByMode[row.mode] ?? 0) + 1
        return card(row, trialByMode[row.mode], comparison.maxSteps)
      }),
    )
    const modes = Object.keys(modeLabels).filter((name) =>
      comparison.rows.some((row) => row.mode === name),
    )
    readouts.replaceChildren(
      ...modes.map((name) => readout(name, comparison.rows)),
    )
    readouts.hidden = false
    const feature = comparison.rows.filter((row) => row.mode === 'feature map')
    const others = comparison.rows.filter((row) => row.mode !== 'feature map')
    const finished = (rows) =>
      rows.filter((row) => row.outcome === 'pass').length
    meaning.textContent =
      feature.length && others.length
        ? `The feature map finished ${finished(feature)} of ${feature.length}; ` +
          `without it, agents finished ${finished(others)} of ${others.length}. ` +
          'A working patch only counts when the agent answers.'
        : 'A working patch only counts when the agent finishes and answers.'
    total.textContent =
      `${comparison.rows.reduce((sum, row) => sum + row.steps, 0)} requests · ` +
      usageText(comparison.usage)
  } catch (error) {
    showError(notice, error)
    meaning.textContent =
      'The comparison did not finish. Check the error and run again.'
  } finally {
    button.disabled = false
    button.textContent = 'Run agents'
  }
})
