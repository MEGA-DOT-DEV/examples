import {
  busy,
  call,
  el,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

const notice = document.getElementById('notice')
const button = document.getElementById('run')
const select = document.getElementById('format')
const result = document.getElementById('result')
const setup = await call('setup')
const LABEL = Object.fromEntries(
  setup.formats[0].versions.map((version) => [version.mode, version.label]),
)
select.replaceChildren(
  ...setup.formats.map(({ name }) => el('option', { value: name }, name)),
)
select.value = setup.selected
document.getElementById('base').textContent =
  `Each request sends the task above with the instructions “${setup.base}”, plus the text in this table.`

// Before a run: the task, and what each of the three requests adds to the instructions.
function showPlan() {
  const format = setup.formats.find((item) => item.name === select.value)
  document.getElementById('task').textContent = format.task
  document
    .getElementById('versions')
    .replaceChildren(
      ...format.versions.map((version) =>
        el(
          'tr',
          {},
          el('td', { class: 'sa-mode' }, version.label),
          el(
            'td',
            {},
            version.guidance || el('span', { class: 'mx-muted' }, 'Nothing'),
          ),
          el('td', { class: 'num' }, String(version.tokens)),
        ),
      ),
    )
}
select.addEventListener('change', showPlan)
showPlan()
const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// An answer of this many lines or fewer stays open: a fold would save no space.
const SHORT_ANSWER = 6
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const list = (items) =>
  new Intl.ListFormat('en', { type: 'conjunction' }).format(items)

function addUsage(total, u) {
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

// The finding in plain words, from the three checks of this run.
function headline(rows) {
  const { none, spelled, name } = Object.fromEntries(
    rows.map((row) => [row.mode, row]),
  )
  const anchor = `“${name.guidance}” (${plural(name.guidanceTokens, 'token')})`
  const rule = `the spelled-out rule (${plural(spelled.guidanceTokens, 'token')})`
  const check = `the ${name.format} check`
  const first =
    name.passed && spelled.passed
      ? `${anchor} did the work of ${rule}: both answers passed ${check}.`
      : name.passed
        ? `${anchor} passed ${check}, and ${rule} missed it.`
        : spelled.passed
          ? `${anchor} missed ${check}, and ${rule} passed it. A miss shows only that the shape is different: open the answer to see it.`
          : `${anchor} and ${rule} both missed ${check}.`
  // The name points to the whole standard, so its answer can hold more than the rule asks for.
  const more =
    name.extras.length > spelled.extras.length
      ? ` The name also brought parts of ${name.format} that the rule did not ask for: ${list(name.extras)}.`
      : ''
  const bare = none.passed
    ? ' With no guidance, the answer passed too, so the task alone was enough here.'
    : ' With no guidance, the answer missed it.'
  return el(
    'div',
    { class: `mx-callout${name.passed ? '' : ' mx-callout--warn'}` },
    el('p', {}, first + more + bare),
  )
}

function mark(ok) {
  return el(
    'span',
    { class: ok ? 'mx-good' : 'mx-bad', 'aria-hidden': 'true' },
    ok ? '✓' : '✗',
  )
}

// One answer: what the check looked for and where the answer met it. The full answer folds when it is long.
function card(row) {
  const lines = row.text.trim().split('\n').length
  return el(
    'article',
    { class: 'mx-panel sa-card' },
    el(
      'div',
      { class: 'mx-spread' },
      el('h3', { class: 'mx-h3' }, LABEL[row.mode]),
      el(
        'b',
        { class: `mx-small ${row.passed ? 'mx-good' : 'mx-bad'}` },
        row.passed ? '✓ passed' : '✗ missed',
      ),
    ),
    el(
      'div',
      { class: 'sa-block' },
      el('span', { class: 'mx-label' }, 'The check'),
      el(
        'ul',
        { class: 'sa-list' },
        row.rules.map((rule) =>
          el(
            'li',
            { class: rule.met ? null : 'is-miss' },
            mark(rule.met),
            el('span', {}, rule.label),
          ),
        ),
      ),
    ),
    // Extras count only in an answer that passed, so a missed answer has no such list.
    row.passed
      ? el(
          'div',
          { class: 'sa-block' },
          el('span', { class: 'mx-label' }, 'Not asked for by the rule'),
          row.extras.length
            ? el(
                'ul',
                { class: 'sa-list' },
                row.extras.map((extra) =>
                  el(
                    'li',
                    {},
                    el(
                      'span',
                      { class: 'sa-plus', 'aria-hidden': 'true' },
                      '+',
                    ),
                    el('span', {}, extra[0].toUpperCase() + extra.slice(1)),
                  ),
                ),
              )
            : el('p', { class: 'mx-small mx-muted sa-none' }, 'Nothing.'),
        )
      : null,
    el(
      'details',
      { class: 'mx-details', open: lines <= SHORT_ANSWER },
      el(
        'summary',
        {},
        el('span', { class: 'mx-label' }, 'Full answer'),
        el('span', { class: 'mx-small mx-muted' }, plural(lines, 'line')),
      ),
      modelText(row.text, 'mx-output sa-answer'),
    ),
  )
}

button.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }
  showError(notice, null)
  const format = select.value
  result.replaceChildren(
    el(
      'p',
      { class: 'mx-muted sa-empty' },
      `Sending 3 requests for ${format}…`,
    ),
  )
  try {
    const rows = await busy(button, 'Running…', () =>
      call('run', { format, ...picker.value() }),
    )
    const total = rows.map((row) => row.usage).reduce(addUsage)
    result.replaceChildren(
      headline(rows),
      el('div', { class: 'sa-cards' }, rows.map(card)),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `The check tests only the shape of the answer: a pass does not prove good content, and a miss can still be a useful answer. Total ${usageText(total)}`,
      ),
      el(
        'details',
        { class: 'mx-details' },
        el(
          'summary',
          {},
          el('span', { class: 'mx-label' }, 'Request and response'),
          el(
            'span',
            { class: 'mx-small mx-muted' },
            plural(rows.length, 'request'),
          ),
        ),
        el(
          'div',
          { class: 'mx-stack sa-pad' },
          rows.flatMap((row) => [
            el(
              'p',
              { class: 'sa-step' },
              el('span', { class: 'mx-label' }, LABEL[row.mode]),
              el('span', { class: 'mx-small mx-muted' }, usageText(row.usage)),
            ),
            requestResponse(row.request, row.response),
          ]),
        ),
      ),
    )
  } catch (error) {
    showError(notice, error)
    result.replaceChildren(
      el(
        'p',
        { class: 'mx-muted sa-empty' },
        'The run failed. Read the note above, then press Compare 3 modes again.',
      ),
    )
  }
})
