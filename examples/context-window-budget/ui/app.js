import {
  busy,
  call,
  codeBlock,
  el,
  missingKeyNote,
  prettyJson,
  providerPicker,
  showError,
  usageText,
} from '../../kit/kit.js'

const MAX_FILE_BYTES = 8_000_000

const setup = await call('setup')
const windowSelect = document.getElementById('window')
const status = document.getElementById('status')
const notice = document.getElementById('notice')
const measureButton = document.getElementById('measure')

// Files keep their text for the API measurement; the bar needs only counts.
let files = []
let filler = 0
let plan = null
let scenario = 'app'

// Request from: the app agent or a coding agent with its harness layers.
const scenarioSeg = document.getElementById('scenario')
function renderScenario() {
  scenarioSeg.replaceChildren(
    ...setup.scenarios.map((s) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(s.id === scenario),
          onclick: () => {
            scenario = s.id
            renderScenario()
            update()
          },
        },
        s.label,
      ),
    ),
  )

  document.getElementById('scenario-hint').textContent = setup.scenarios.find(
    (s) => s.id === scenario,
  ).hint
}
renderScenario()

const n = (value) => value.toLocaleString('en-US')
const pct = (share) =>
  `${(share * 100).toFixed(share > 0 && share < 0.01 ? 2 : 1)}%`

// ── The bar and the table ──────────────────────────────────────────────

function readout(label, value) {
  return el(
    'div',
    { class: 'mx-readout' },
    el('span', { class: 'mx-label' }, label),
    el('b', {}, value),
  )
}

// The headline: where this request sits against the window, and where the smart zone ends.
function renderHeadline({ used, over, share, zone, window }) {
  const { edgeFrom, edgeTo } = setup.smartZone
  const where = over
    ? `This request uses ${n(used)} tokens: ${n(over)} more than the window holds.`
    : `This request uses ${n(used)} of ${n(window)} tokens (${pct(share)}).`

  document.getElementById('headline').replaceChildren(
    el(
      'div',
      {
        class: `mx-callout${zone === 'outside' || zone === 'over' ? ' mx-callout--warn' : ''}`,
      },
      el('span', { class: 'mx-label' }, 'Result'),
      el(
        'p',
        {},
        `${where} ${setup.zoneText[zone]} For this window, the smart zone ends at about ${n(Math.round(window * edgeFrom))} to ${n(Math.round(window * edgeTo))} tokens.`,
      ),
    ),
  )
}

function render() {
  const { used, over, share, segments, marks } = plan
  renderHeadline(plan)

  // The smart zone: solid from 0, fading out across its soft edge (30-40%).
  const { edgeFrom, edgeTo } = marks
  // el() drops null children; replaceChildren() would print "null".
  document.getElementById('bar').replaceChildren(
    ...[
      el(
        'span',
        {
          class: 'cw-smart',
          style: {
            width: `${edgeTo * 100}%`,
            '--edge-start': `${(edgeFrom / edgeTo) * 100}%`,
          },
        },
        el(
          'span',
          { class: 'cw-smart-label' },
          `Smart zone · up to about ${setup.smartZone.edgeFrom * 100}-${setup.smartZone.edgeTo * 100}%`,
        ),
      ),
      el(
        'span',
        { class: 'cw-fill' },
        segments.map((s) =>
          el('i', {
            class: `cw-seg cw-seg--${s.id}`,
            style: { width: `${s.width * 100}%` },
            title: `${s.label}: ${n(s.tokens)} tokens, ${pct(s.share)} of the window`,
          }),
        ),
      ),
      over
        ? el('span', {
            class: 'cw-overflow',
            style: { left: `${marks.limit * 100}%` },
            title: `${n(over)} tokens over the limit`,
          })
        : null,
      over
        ? el(
            'span',
            { class: 'cw-limit', style: { left: `${marks.limit * 100}%` } },
            el('span', {}, 'limit'),
          )
        : null,
    ].filter(Boolean),
  )

  // The scale is in shares of the window. Over the limit, the bar is longer than the window.
  const barEnd = Math.max(1, share)
  document
    .getElementById('scale')
    .replaceChildren(
      ...[0, 0.25, 0.5, 0.75, 1].map((f) =>
        el('span', {}, f ? `${Math.round(f * barEnd * 100)}%` : '0'),
      ),
    )

  // The swatches in the first column are the legend of the bar.
  document
    .getElementById('blocks')
    .replaceChildren(
      ...segments.map((s) =>
        el(
          'tr',
          {},
          el(
            'td',
            {},
            el(
              'span',
              { class: 'cw-cell' },
              el('i', { class: `cw-swatch cw-seg--${s.id}` }),
              s.label,
            ),
          ),
          el('td', { class: 'cw-detail' }, s.detail),
          el('td', { class: 'num' }, n(s.tokens)),
          el('td', { class: 'num' }, pct(s.tokens / used)),
        ),
      ),
      el(
        'tr',
        { class: 'cw-total' },
        el('td', {}, 'Total'),
        el('td'),
        el('td', { class: 'num' }, n(used)),
        el('td'),
      ),
    )

  const tooBig = used > setup.measureMax
  measureButton.disabled = tooBig

  const hint = document.getElementById('measure-hint')
  hint.textContent = tooBig
    ? `This request has ${n(used)} tokens. The limit to measure is ${n(setup.measureMax)}. Remove filler or files first.`
    : ''
  hint.classList.toggle('mx-bad', tooBig)

  renderAdded()
}

function renderAdded() {
  const chips = files.map((f, i) =>
    el(
      'span',
      { class: 'mx-chip mx-chip--static' },
      `${f.name} · ${n(f.tokens)}`,
      el(
        'button',
        {
          class: 'cw-x',
          type: 'button',
          'aria-label': `Remove ${f.name}`,
          onclick: () => {
            files.splice(i, 1)
            update()
          },
        },
        '×',
      ),
    ),
  )

  if (filler) {
    chips.push(
      el(
        'span',
        { class: 'mx-chip mx-chip--static' },
        `Filler · ${n(filler * setup.fillerTokens)}`,
        el(
          'button',
          {
            class: 'cw-x',
            type: 'button',
            'aria-label': 'Remove filler',
            onclick: () => {
              filler = 0
              update()
            },
          },
          '×',
        ),
      ),
    )
  }

  document.getElementById('added').replaceChildren(...chips)
}

async function update() {
  try {
    plan = await call('plan', {
      files: files.map(({ name, tokens }) => ({ name, tokens })),
      filler,
      scenario,
      window: Number(windowSelect.value),
    })
    render()
  } catch (error) {
    status.textContent = error.message
  }
}

// ── Adding text ────────────────────────────────────────────────────────

// The viewer takes 1 MB per call, so a big file is counted in pieces.
// Cutting at a line break keeps the count almost exactly the same.
function pieces(text, max) {
  const out = []
  let i = 0

  while (i < text.length) {
    let end = Math.min(text.length, i + max)
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end)
      if (nl > i) {
        end = nl + 1
      } else if (/[\uD800-\uDBFF]/.test(text[end - 1])) {
        end -= 1
      }
    }

    out.push(text.slice(i, end))
    i = end
  }

  return out
}

async function addFile(name, text) {
  if (files.length >= setup.maxFiles) {
    status.textContent = `Up to ${setup.maxFiles} files.`
    return
  }

  let tokens = 0
  const parts = pieces(text, setup.maxChunk)

  for (const [i, part] of parts.entries()) {
    if (parts.length > 1) {
      status.textContent = `Counting ${name}: part ${i + 1} of ${parts.length}…`
    }
    tokens += (await call('count', { text: part })).tokens
  }

  files.push({ name, text, tokens })
  status.textContent = `${name}: ${n(text.length)} characters, ${n(tokens)} tokens.`

  await update()
}

function addFiller(blocks) {
  filler = Math.min(setup.maxFiller, filler + blocks)

  if (filler === setup.maxFiller) {
    status.textContent = `Filler stops at ${n(setup.maxFiller * setup.fillerTokens)} tokens.`
  }

  update()
}

document
  .getElementById('filler-10k')
  .addEventListener('click', () => addFiller(1))
document
  .getElementById('filler-100k')
  .addEventListener('click', () => addFiller(10))

document.getElementById('reset').addEventListener('click', () => {
  files = []
  filler = 0
  status.textContent = ''
  update()
})

document.getElementById('load').addEventListener('change', async (event) => {
  for (const file of event.target.files) {
    if (file.size > MAX_FILE_BYTES) {
      status.textContent = `${file.name} is larger than 8 MB. Use the CLI: --file ${file.name}`
      continue
    }

    try {
      await addFile(file.name, await file.text())
    } catch (error) {
      status.textContent = `${file.name}: ${error.message}`
    }
  }
  event.target.value = ''
})

document.getElementById('paste-add').addEventListener('click', async () => {
  const text = document.getElementById('paste-text').value
  if (!text) {
    status.textContent = 'Paste some text first.'
    return
  }

  try {
    await addFile(
      document.getElementById('paste-name').value.trim() || 'pasted.txt',
      text,
    )
    document.getElementById('paste-text').value = ''
  } catch (error) {
    status.textContent = error.message
  }
})

// ── Measure with the API ───────────────────────────────────────────────

function renderMeasured(result) {
  const sign = result.difference >= 0 ? '+' : ''

  document.getElementById('measured').hidden = false
  document
    .getElementById('measured')
    .replaceChildren(
      el(
        'div',
        { class: 'mx-readouts' },
        readout('Local count', n(result.local)),
        readout('API input tokens', n(result.inputTokens)),
        readout('Difference', `${sign}${n(result.difference)}`),
      ),
      el(
        'p',
        { class: 'mx-small cw-copy' },
        "The API uses the model's own tokenizer. It also counts the wrapper that the model reads: role tokens around each message and the tool definitions in its own format. ",
        'The chat-template example shows this wrapper.',
      ),
      el(
        'p',
        { class: 'mx-small mx-muted' },
        `${result.provider} · ${result.model} · ${result.ms} ms · ${usageText(result.usage)}${result.status !== 'completed' ? ' · the answer stops at the output limit, as planned' : ''}`,
      ),
      raw('Request sent', result.request),
      raw('Response received', result.response),
    )
}

// The kit's requestResponse(), with a note that long texts are shortened in the view.
const raw = (label, value) =>
  el(
    'details',
    { class: 'mx-details' },
    el(
      'summary',
      {},
      el('span', { class: 'mx-label' }, label),
      ' ',
      el('span', { class: 'mx-hint' }, 'long texts shortened'),
    ),
    codeBlock(prettyJson(value), 'json'),
  )

// Measuring is optional, so the missing-key note shows only after a press.
const picker = await providerPicker(document.getElementById('picker'))

measureButton.addEventListener('click', async () => {
  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  try {
    const result = await busy(measureButton, 'Measuring…', () =>
      call('measure', {
        files: files.map(({ name, text }) => ({ name, text })),
        filler,
        scenario,
        ...picker.value(),
      }),
    )
    notice.replaceChildren()
    renderMeasured(result)
  } catch (error) {
    showError(notice, error)
  }
})

windowSelect.append(
  ...setup.windows.map((w) =>
    el('option', { value: w.tokens }, `${w.model} · ${n(w.tokens)}`),
  ),
)
windowSelect.addEventListener('change', update)
await update()
