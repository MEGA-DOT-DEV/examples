import {
  call,
  codeBlock,
  el,
  missingKeyNote,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const button = document.getElementById('run')
const rows = document.getElementById('rows')
const readouts = document.getElementById('readouts')
const verdict = document.getElementById('verdict')
const setup = await call('setup')
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

const MODES = setup.modes
const NEED = {
  style: (request) => `Needs the ${request.skill} skill`,
  tool: () => 'Needs no skill',
  skill: (request) => `Needs the ${request.skill} skill alone, no image`,
}
const WORDS = {
  width: 'Width',
  height: 'Height',
  colors: 'Colors',
  smoothing: 'Smoothing',
}

// ── Setup folds ────────────────────────────────────────────────────────
const wrapped = (text) => {
  const block = codeBlock(text)
  block.dataset.wrap = ''
  return block
}
document
  .getElementById('tool-text')
  .append(
    ...MODES.flatMap((mode) => [
      el('span', { class: 'mx-label' }, mode.label),
      wrapped(mode.tool),
    ]),
  )
document.getElementById('skills-note').textContent =
  `${setup.skills.length} skills · description and body · 2 modes`
document
  .getElementById('skill-text')
  .append(
    ...MODES.flatMap((mode) => [
      el('span', { class: 'mx-label' }, mode.label),
      ...mode.skills.map((skill) =>
        wrapped(
          `list_skills: ${skill.id}: ${skill.about}\n\nload_skill:\n${skill.text}`,
        ),
      ),
    ]),
  )

// ── The table: one row per request, one column per mode ────────────────
for (const mode of MODES) {
  document.getElementById(`head-${mode.id}`).textContent = mode.label
}

function mark(pass) {
  return el(
    'b',
    { class: pass ? 'mx-good' : 'mx-bad' },
    pass ? '✓ pass' : '✗ fail',
  )
}

function cell(outcome) {
  if (!outcome) {
    return el('td', { class: 'mx-muted' }, 'Running…')
  }

  const lines = [
    skillLine(outcome),
    ...RESULT_LINES[outcome.request.need](outcome),
  ]
  const path =
    outcome.steps
      .flatMap((step) => step.calls.map((tool) => tool.name))
      .join(' → ') || 'text answer only'

  return el(
    'td',
    {},
    el(
      'div',
      { class: 'tl-cell' },
      mark(outcome.pass),
      ...lines,
      el('span', { class: 'tl-path mx-mono' }, path),
    ),
  )
}

function skillLine({ request, loaded }) {
  const skillOk =
    request.need === 'tool'
      ? loaded.length === 0
      : loaded.includes(request.skill)

  return el(
    'span',
    { class: skillOk ? '' : 'mx-bad' },
    `Skill: ${loaded.length ? loaded.join(', ') : 'none'}`,
  )
}

// What reached the tool, by what the request needs.
const RESULT_LINES = {
  // The argument check: what reached the tool, against the skill.
  style: ({ checks }) =>
    checks.map((check) =>
      el(
        'span',
        { class: check.pass ? '' : 'mx-bad' },
        `${WORDS[check.name]} ${check.got ?? '—'}${check.pass ? '' : ` · skill says ${check.want}`}`,
      ),
    ),
  tool: ({ call: image }) => [
    el(
      'span',
      { class: image ? '' : 'mx-bad' },
      image ? `Image: ${image.width} × ${image.height}` : 'No image',
    ),
  ],
  skill: ({ call: image }) => [
    el(
      'span',
      { class: image ? 'mx-bad' : '' },
      image ? 'Made an image' : 'No image',
    ),
  ],
}

function render(results) {
  rows.replaceChildren(
    ...setup.requests.map((request, index) =>
      el(
        'tr',
        {},
        el(
          'td',
          {},
          el(
            'div',
            { class: 'tl-request' },
            el('span', {}, request.text),
            el('span', { class: 'mx-hint' }, NEED[request.need](request)),
          ),
        ),
        ...MODES.map((mode) => cell(results[mode.id]?.outcomes[index])),
      ),
    ),
  )
}

function readout(mode, result) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, mode.label),
    el('b', {}, `${result.passed} of ${result.outcomes.length}`),
  )
}

// What the two columns mean. The table holds the facts.
function meaning(results) {
  const styled = (result) =>
    result.outcomes.filter((outcome) => outcome.request.need === 'style')
  const missed = (result) =>
    styled(result).filter((outcome) => !outcome.pass).length
  const before = missed(results.unlinked)
  const after = missed(results.linked)
  const total = styled(results.unlinked).length

  const lines = [
    before === after
      ? `Styled images that missed the skill's arguments: ${before} of ${total} in both modes. The links made no difference in this run.`
      : `Styled images that missed the skill's arguments: ${before} of ${total} without links, ${after} of ${total} with links.`,
  ]

  const controls = Object.values(results).flatMap((result) =>
    result.outcomes.filter((outcome) => outcome.request.need !== 'style'),
  )
  lines.push(
    controls.every((outcome) => outcome.pass)
      ? 'The photo used the tool alone and the size question used the skill alone in both modes: a link does not force them together.'
      : 'The photo or the size question failed in one mode: see its row.',
  )

  return lines.join(' ')
}

function stepsFold(mode, result) {
  const steps = result.outcomes.flatMap((outcome, index) =>
    outcome.steps.map((step) => ({ step, index })),
  )

  return el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el(
        'span',
        { class: 'mx-label' },
        `Requests and responses · ${mode.label}`,
      ),
      el(
        'span',
        { class: 'mx-small mx-muted' },
        `${steps.length} requests · ${usageText(result.usage)}`,
      ),
    ),
    el(
      'div',
      { class: 'tl-pad mx-stack' },
      ...steps.map(({ step, index }) =>
        el(
          'div',
          { class: 'mx-stack' },
          el(
            'span',
            { class: 'mx-label' },
            `Request ${index + 1} · step ${step.number}`,
          ),
          requestResponse(step.request, step.response),
        ),
      ),
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  showError(notice, null)
  button.disabled = true
  document.getElementById('empty').hidden = true
  readouts.hidden = true
  verdict.hidden = true
  document.getElementById('steps').replaceChildren()

  const results = {}
  render(results)
  try {
    await Promise.all(
      MODES.map(async (mode) => {
        results[mode.id] = await call('run', {
          mode: mode.id,
          ...picker.value(),
        })
        render(results)
      }),
    )

    readouts.replaceChildren(
      ...MODES.map((mode) => readout(mode, results[mode.id])),
    )
    readouts.hidden = false
    verdict.textContent = meaning(results)
    verdict.hidden = false
    document
      .getElementById('steps')
      .replaceChildren(
        ...MODES.map((mode) => stepsFold(mode, results[mode.id])),
      )
  } catch (error) {
    showError(notice, error)
  } finally {
    button.disabled = false
  }
})

render({})
