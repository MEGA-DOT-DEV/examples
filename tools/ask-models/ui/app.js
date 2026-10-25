import {
  busy,
  call,
  codeBlock,
  el,
  formatCost,
  missingKeyNote,
  modelText,
  providerPicker,
  requestResponse,
  showError,
  usageText,
} from '../../kit/kit.js'

// Broad questions: a good answer has more points than one short answer holds.
const PRESETS = [
  [
    'Agent emails',
    'We want an AI agent to send emails on behalf of our users. What do we need to get right before we ship?',
  ],
  [
    'Coding agent',
    'We are about to let an AI coding agent open pull requests in our main repository. What do we need to get right first?',
  ],
  [
    'Self-service refunds',
    'We want customers to refund themselves from their account page, without talking to support. What do we need to get right?',
  ],
]
const ADD_HINT = {
  openrouter: 'Add a model ID from openrouter.ai/models, as lab/model',
  openai: 'Add an OpenAI model ID, for example gpt-6-sol',
}

const questionBox = document.getElementById('question')
const askButton = document.getElementById('ask')
const mergeModel = document.getElementById('merge-model')
const addInput = document.getElementById('add-model')
const addPerspective = document.getElementById('add-perspective')
const notice = document.getElementById('notice')
const cards = document.getElementById('cards')
const headline = document.getElementById('headline')
const mergedBox = document.getElementById('merged')

const defaults = await call('defaults')
questionBox.value = defaults.question
let provider = null
let models = []
let perspectives = [...defaults.perspectives]
let seats = []
// Answers of the last run, by seat number.
let answers = new Map()
let mergeCost = null

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const shortModel = (id) => id.split('/').pop()
const seatLabel = (s) =>
  s.perspective ? `${s.model} as ${s.perspective}` : s.model

// One chip per item, with a remove button.
function chipList(container, items, remove) {
  container.replaceChildren(
    ...items.map((item) =>
      el(
        'span',
        { class: 'mx-chip mx-chip--static am-chip' },
        item,
        el(
          'button',
          {
            type: 'button',
            class: 'am-remove',
            'aria-label': `Remove ${item}`,
            title: 'Remove',
            onclick: () => remove(item),
          },
          '×',
        ),
      ),
    ),
  )
}

async function renderSettings() {
  document.getElementById('model-count').textContent =
    `· ${models.length} of ${defaults.maxModels}`
  document.getElementById('perspective-count').textContent =
    `· ${perspectives.length} of ${defaults.maxPerspectives}`

  chipList(document.getElementById('chips'), models, (m) => {
    models = models.filter((x) => x !== m)
    void renderSettings()
  })
  chipList(document.getElementById('perspective-chips'), perspectives, (p) => {
    perspectives = perspectives.filter((x) => x !== p)
    void renderSettings()
  })

  addInput.disabled = models.length >= defaults.maxModels
  addPerspective.disabled = perspectives.length >= defaults.maxPerspectives

  // api.ts pairs models with perspectives, the same way a run does.
  seats = models.length
    ? await call('seats', { models, perspectives }).catch((error) => {
        showError(notice, error)
        return []
      })
    : []

  document
    .getElementById('seats')
    .replaceChildren(
      ...seats.map((s) =>
        el(
          'li',
          {},
          el('code', {}, shortModel(s.model)),
          s.perspective ? ` as ${s.perspective}` : ' with no role',
        ),
      ),
    )

  document.getElementById('seat-count').textContent = `· ${seats.length}`
  askButton.disabled = seats.length === 0

  const merge = seats.length > 1 ? ' and 1 merge request' : ''
  document.getElementById('empty').textContent = seats.length
    ? `Press Ask. ${plural(seats.length, 'short request')}${merge}: about 1 cent.`
    : 'Add a model to ask.'
}

function useDefaults() {
  models = [...(defaults.models[provider] ?? [])]
  perspectives = [...defaults.perspectives]

  addInput.placeholder = ADD_HINT[provider] ?? 'Add a model ID'

  const current = picker.providers().find((p) => p.id === provider)
  mergeModel.placeholder = current ? current.model : ''
  void renderSettings()
}

const picker = await providerPicker(document.getElementById('picker'), {
  model: false,
  onChange: () => {
    // Model IDs differ per provider (lab/model on OpenRouter), so switch the list too.
    if (picker.value().provider !== provider) {
      provider = picker.value().provider
      useDefaults()
    }
  },
})

provider = picker.value().provider ?? 'openrouter'
useDefaults()

if (!picker.hasKey()) {
  missingKeyNote(notice)
}

// The raw request and response of one request, behind one fold.
const rawFold = (title, request, response) =>
  el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, 'Request and response'),
      el('span', { class: 'mx-hint' }, title),
    ),
    el('div', { class: 'am-pad' }, requestResponse(request, response)),
  )

function card(seat) {
  const status = el('span', { class: 'mx-label' }, 'waiting')
  const body = el(
    'div',
    { class: 'mx-stack' },
    el('p', { class: 'mx-muted mx-small am-wait' }, 'Waiting for the answer…'),
  )

  const node = el(
    'article',
    { class: 'mx-panel am-card' },
    el(
      'div',
      { class: 'mx-spread am-card-head' },
      el(
        'div',
        { class: 'am-who' },
        el('b', { class: 'am-num' }, String(seat.seat)),
        el('span', {}, seat.perspective ?? 'no role'),
        el('code', { class: 'am-model' }, seat.model),
      ),
      status,
    ),
    body,
  )

  cards.append(node)
  return { status, body, node }
}

function fill(view, answer) {
  view.status.textContent = seconds(answer.ms)
  view.body.replaceChildren(
    ...[
      answer.text
        ? modelText(answer.text)
        : el('p', { class: 'mx-output' }, '(no text)'),
      answer.status === 'incomplete'
        ? el(
            'p',
            { class: 'mx-small mx-bad' },
            'The answer stopped at max_output_tokens.',
          )
        : null,
      el('p', { class: 'mx-small mx-muted am-usage' }, usageText(answer.usage)),
      rawFold(shortModel(answer.model), answer.request, answer.response),
    ].filter(Boolean),
  )
}

function renderTotals(asked) {
  const list = [...answers.values()]
  const costs = [...list.map((a) => a.usage.cost), mergeCost].filter(
    (c) => c != null,
  )
  const cost = costs.length ? costs.reduce((s, c) => s + c, 0) : null
  const estimate = list.some((a) => a.usage.costSource === 'estimate')
  const slowest = Math.max(0, ...list.map((a) => a.ms))
  const sum = list.reduce((s, a) => s + a.ms, 0)

  const readout = (label, value, note) =>
    el(
      'div',
      { class: 'mx-readout' },
      el('span', { class: 'mx-label' }, label),
      el('b', {}, value),
      note ? el('span', { class: 'mx-small mx-muted' }, note) : null,
    )

  document
    .getElementById('totals')
    .replaceChildren(
      readout('Answered', `${list.length}/${asked}`),
      readout('Time', seconds(slowest), `${seconds(sum)} one after another`),
      readout(
        'Tokens',
        String(
          list.reduce(
            (s, a) => s + a.usage.inputTokens + a.usage.outputTokens,
            0,
          ),
        ),
        `${list.reduce((s, a) => s + a.usage.inputTokens, 0)} in · ${list.reduce((s, a) => s + a.usage.outputTokens, 0)} out`,
      ),
      readout(
        'Cost',
        formatCost(cost),
        [
          mergeCost != null ? 'with the merge' : '',
          estimate ? 'est. for OpenAI' : '',
        ]
          .filter(Boolean)
          .join(' · ') || null,
      ),
    )
}

function setHeadline(text, warn = false, label = warn ? 'No merge' : 'Result') {
  headline.replaceChildren(
    el(
      'div',
      { class: warn ? 'mx-callout mx-callout--warn' : 'mx-callout' },
      el('span', { class: 'mx-label' }, label),
      el('p', {}, text),
    ),
  )
}

async function askAll() {
  const question = questionBox.value.trim()
  if (!question) {
    return showError(notice, new Error('Type a question first.'))
  }
  if (!seats.length) {
    return showError(notice, new Error('Add at least one model.'))
  }
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  // A key added since the page loaded can change the provider.
  if (picker.value().provider !== provider) {
    provider = picker.value().provider
    useDefaults()
    return showError(
      notice,
      new Error(
        'The provider changed, so the model list changed too. Check it and press Ask again.',
      ),
    )
  }

  notice.replaceChildren()
  document.getElementById('empty').hidden = true
  document.getElementById('result').hidden = false
  document.getElementById('answers-box').hidden = false
  mergedBox.hidden = true
  cards.replaceChildren()
  answers = new Map()
  mergeCost = null

  const run = seats.map((s, i) => ({ ...s, seat: i + 1 }))
  const { provider: chosen } = picker.value()

  setHeadline(
    `Sending ${plural(run.length, 'request')} at the same time…`,
    false,
    'Working',
  )
  renderTotals(run.length)

  await busy(askButton, 'Asking…', async () => {
    await Promise.all(
      run.map(async (seat) => {
        const view = card(seat)
        const started = performance.now()
        const clock = setInterval(
          () =>
            (view.status.textContent = `${seconds(performance.now() - started)}…`),
          100,
        )

        try {
          // One request per seat: this card fills when its model ends.
          const answer = await call('ask', {
            question,
            model: seat.model,
            perspective: seat.perspective,
            provider: chosen,
          })
          answers.set(seat.seat, answer)
          fill(view, answer)
        } catch (error) {
          view.status.textContent = 'failed'
          view.node.classList.add('am-failed')
          showError(view.body, error)
        } finally {
          clearInterval(clock)
          renderTotals(run.length)
        }
      }),
    )

    // The merge numbers the answers it gets, in seat order. Seats without text are left out.
    const answered = run.filter((s) => answers.get(s.seat)?.text.trim())
    if (answered.length < 2) {
      return setHeadline(
        `${answered.length} of ${run.length} requests answered. The merge needs at least two answers.`,
        true,
      )
    }

    await mergeAll(question, chosen, answered, run.length)
  })
}

// One row per point: the text, a dot for each answer that makes it, and the merged answer.
function pointRow(point, answered) {
  return el(
    'tr',
    { class: point.answers.length === 1 ? 'am-own' : null },
    // modelText: a point is model output, so `code` and **bold** render, never raw Markdown.
    el(
      'td',
      { class: 'am-point' },
      modelText(point.text, 'am-point-text'),
      // The merge named an answer that does not exist: code dropped the number and says so.
      point.unknown.length
        ? el(
            'span',
            { class: 'mx-small mx-muted' },
            `No answer ${point.unknown.join(', ')}: dropped.`,
          )
        : null,
    ),
    answered.map((s, i) => {
      const made = point.answers.includes(i + 1)
      return el(
        'td',
        {
          class: 'am-cell',
          title: made ? `Answer ${s.seat} makes this point` : null,
        },
        made ? el('span', { class: 'am-dot', 'aria-label': 'yes' }) : null,
      )
    }),
    el(
      'td',
      { class: 'am-cell am-merged' },
      el('span', { class: 'am-dot', 'aria-label': 'yes' }),
    ),
  )
}

function grid(points, coverage, answered) {
  const own = points.filter((p) => p.answers.length === 1)
  const shared = points.filter((p) => p.answers.length !== 1)
  const span = answered.length + 2

  const group = (text) =>
    el('tr', { class: 'am-group' }, el('td', { colspan: String(span) }, text))
  const footRow = (label, values, last) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row' }, label),
      values.map((v) => el('td', { class: 'am-cell am-count' }, String(v))),
      el('td', { class: 'am-cell am-count am-merged' }, last),
    )

  return el(
    'div',
    { class: 'mx-table-wrap' },
    el(
      'table',
      { class: 'mx-table am-grid' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Point'),
          answered.map((s) =>
            el(
              'th',
              { class: 'am-col', title: seatLabel(s) },
              el('b', {}, String(s.seat)),
              el(
                'span',
                {},
                s.perspective ? s.perspective.split(' ')[0] : 'plain',
              ),
              el('span', {}, shortModel(s.model)),
            ),
          ),
          el('th', { class: 'am-col am-merged' }, el('b', {}, 'Merged')),
        ),
      ),
      el(
        'tbody',
        {},
        own.length ? group('Made by one answer only') : null,
        own.map((p) => pointRow(p, answered)),
        shared.length ? group('Made by two or more answers') : null,
        shared.map((p) => pointRow(p, answered)),
      ),
      el(
        'tfoot',
        {},
        footRow(
          'Points',
          coverage.answers.map((a) => a.made),
          String(coverage.total),
        ),
        footRow(
          'Only here',
          coverage.answers.map((a) => a.only),
          '',
        ),
      ),
    ),
  )
}

function mergeHeadline(c) {
  const made = c.answers.map((a) => a.made)
  const only = c.answers.reduce((s, a) => s + a.only, 0)
  const range =
    Math.min(...made) === Math.max(...made)
      ? `${Math.min(...made)}`
      : `${Math.min(...made)} to ${Math.max(...made)}`
  const none = c.unsourced
    ? ` ${plural(c.unsourced, 'point')} name no answer: the merge model wrote them.`
    : ''

  return `The merged answer has ${c.total} points. Each answer made ${range} of them, and ${only} came from one answer only.${none}`
}

async function mergeAll(question, chosen, answered, asked) {
  setHeadline(`Merging ${answered.length} answers…`, false, 'Working')

  try {
    const merged = await call('merge', {
      question,
      answers: answered.map((s) => ({
        model: s.model,
        perspective: s.perspective,
        text: answers.get(s.seat).text,
      })),
      provider: chosen,
      model: mergeModel.value.trim() || undefined,
    })

    mergeCost = merged.usage.cost
    renderTotals(asked)

    if (merged.points) {
      setHeadline(mergeHeadline(merged.coverage))
    } else {
      setHeadline(merged.error, true, 'Could not read the merge')
    }

    mergedBox.hidden = false
    mergedBox.replaceChildren(
      ...[
        merged.points
          ? grid(merged.points, merged.coverage, answered)
          : merged.text
            ? codeBlock(merged.text)
            : null,
        merged.status === 'incomplete'
          ? el(
              'p',
              { class: 'mx-small mx-bad' },
              'The merge stopped at max_output_tokens.',
            )
          : null,
        el(
          'p',
          { class: 'mx-small mx-muted am-usage' },
          `Merged by ${merged.model} in ${seconds(merged.ms)} · ${usageText(merged.usage)}`,
        ),
        rawFold('merge', merged.request, merged.response),
      ].filter(Boolean),
    )
  } catch (error) {
    setHeadline('The merge request failed. The answers are below.', true)
    showError(notice, error)
  }
}

document.getElementById('presets').append(
  ...PRESETS.map(([label, text]) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        title: text,
        onclick: () => {
          questionBox.value = text
          questionBox.focus()
        },
      },
      label,
    ),
  ),
)

document.getElementById('add-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const id = addInput.value.trim()
  if (!id) {
    return
  }

  if (!models.includes(id) && models.length < defaults.maxModels) {
    models.push(id)
  }

  addInput.value = ''
  void renderSettings()
})

document
  .getElementById('add-perspective-form')
  .addEventListener('submit', (event) => {
    event.preventDefault()
    const role = addPerspective.value.trim().replace(/\s+/g, ' ')
    if (!role) {
      return
    }

    if (
      !perspectives.includes(role) &&
      perspectives.length < defaults.maxPerspectives
    ) {
      perspectives.push(role)
    }

    addPerspective.value = ''
    void renderSettings()
  })

document.getElementById('reset').addEventListener('click', useDefaults)
askButton.addEventListener('click', askAll)
questionBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (!askButton.disabled) {
      askAll()
    }
  }
})
