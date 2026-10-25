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

const { maxRuns, maxParallel, efforts, checks, presets } = await call('limits')

const promptBox = document.getElementById('prompt')
const checkSelect = document.getElementById('check')
const runsInput = document.getElementById('runs')
const tempInput = document.getElementById('temperature')
const button = document.getElementById('go')
const notice = document.getElementById('notice')
let effort = 'low'
// Results of the current batch, by run index. null while a run waits.
let results = []
let batch = 0

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

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`

/** The headline: distinct answers first, then the most frequent one, wrong and failed runs. */
function headline(done, count, ranked, wrong, failed, check) {
  if (!done.length) {
    return failed
      ? `${plural(failed, 'run')} failed. No answer yet.`
      : `Running ${plural(count, 'request')}…`
  }

  const soFar = done.length + failed < count ? 'So far, ' : ''
  const leader = ranked[0]
  const pct = Math.round((leader.count / done.length) * 100)

  const parts = [
    ranked.length === 1
      ? `${soFar ? `${soFar}all` : 'All'} ${plural(done.length, 'run')} gave the same answer: ${leader.answer}.`
      : `${soFar}${done.length} runs gave ${ranked.length} distinct answers. The most frequent is ${leader.answer} (${leader.count} runs, ${pct}%).`,
  ]

  if (check !== 'none') {
    parts.push(
      wrong
        ? `${plural(wrong, 'answer')} ${wrong === 1 ? 'is' : 'are'} wrong.`
        : 'No answer is wrong.',
    )
  }

  if (failed) {
    parts.push(`${plural(failed, 'run')} failed.`)
  }

  return parts.join(' ')
}

function render(check, count) {
  const done = results.filter((r) => r?.ok)
  const failed = results.filter((r) => r && !r.ok).length
  const wrong = done.filter((r) => r.run.valid === false).length

  // Count each distinct answer. "3 7" and "7 3" are different answers.
  const tally = new Map()
  // A number from 1 to 10: show every value, also the ones never picked.
  if (check === 'one-to-ten') {
    for (let n = 1; n <= 10; n++) {
      tally.set(String(n), { answer: String(n), count: 0, valid: true })
    }
  }

  for (const { run } of done) {
    const row = tally.get(run.answer) ?? {
      answer: run.answer,
      count: 0,
      valid: run.valid,
    }
    row.count++
    tally.set(run.answer, row)
  }

  const rows = [...tally.values()]
  if (check !== 'one-to-ten') {
    rows.sort((a, b) => b.count - a.count)
  }

  // Bars show the share of the answered runs, so 10 of 10 fills the bar.
  const answered = Math.max(1, done.length)
  const fair = check === 'one-to-ten' ? 1 / 10 : null
  const pct = (n) => `${Math.round((n / answered) * 100)}%`
  document.getElementById('tally').replaceChildren(
    ...rows.map((t) =>
      el(
        'div',
        {
          class: `sp-bar-row${t.valid === false ? ' wrong' : ''}${t.count ? '' : ' zero'}`,
        },
        el(
          'code',
          {
            class: 'sp-answer',
            title: t.valid === false ? 'Wrong answer' : t.answer,
          },
          t.answer,
        ),
        el(
          'span',
          {
            class: `mx-meter${t.valid === false ? ' mx-meter--accent' : ''}`,
          },
          el('i', { style: { width: `${(t.count / answered) * 100}%` } }),
          fair && done.length
            ? el('b', {
                class: 'sp-fair',
                style: { left: `${fair * 100}%` },
                title: 'A fair pick: 10% each',
              })
            : null,
        ),
        el(
          'span',
          { class: 'sp-count' },
          `${t.count} `,
          el('small', {}, `· ${pct(t.count)}`),
          t.valid === false
            ? el('small', { class: 'mx-bad' }, ' · wrong')
            : null,
        ),
      ),
    ),
  )
  document.getElementById('fair-note').hidden = !(fair && done.length)

  const started = batch > 0
  document.getElementById('empty').hidden = started
  document.getElementById('headline').hidden = !started
  document.getElementById('answers').hidden = !started
  if (started) {
    const ranked = rows.filter((t) => t.count).sort((a, b) => b.count - a.count)
    document.getElementById('headline-text').textContent = headline(
      done,
      count,
      ranked,
      wrong,
      failed,
      check,
    )
  }

  let total = null
  for (const { run } of done) {
    total = addUsage(total, run.usage)
  }
  document.getElementById('total').textContent = total
    ? `Total for ${plural(done.length, 'run')}: ${usageText(total)}`
    : ''
  document.getElementById('meta').textContent = done[0]?.run.model ?? ''
}

function runRow(i, entry) {
  const n = el('td', { class: 'num' }, String(i + 1))
  if (!entry) {
    return el(
      'tr',
      { class: 'sp-waiting' },
      n,
      el('td', { colspan: '4', class: 'mx-muted' }, 'waiting…'),
    )
  }

  if (!entry.ok) {
    return el(
      'tr',
      {},
      n,
      el('td', { colspan: '4', class: 'mx-bad' }, entry.error),
    )
  }

  const { run } = entry
  const mark =
    run.valid === null
      ? el('span', { class: 'mx-muted' }, '—')
      : run.valid
        ? el('span', { class: 'mx-good' }, `valid · ${run.note}`)
        : el('span', { class: 'mx-bad' }, `wrong · ${run.note}`)

  return el(
    'tr',
    {},
    n,
    el(
      'td',
      {},
      el('code', { title: run.text }, run.answer),
      run.incompleteReason
        ? el(
            'span',
            { class: 'mx-bad mx-small' },
            ` cut: ${run.incompleteReason}`,
          )
        : null,
    ),
    el('td', {}, mark),
    el('td', { class: 'mx-small mx-muted' }, usageText(run.usage)),
    el('td', { class: 'num' }, String(run.ms)),
  )
}

// A preset's prompt is always scored with its own check: "Sum is 10" checked
// as "a number from 1 to 10" marks every right answer wrong. "No check" stays
// allowed for any prompt; a prompt you wrote yourself keeps the check you pick.
function matchCheckToPrompt() {
  const preset = presets.find((p) => p.prompt === promptBox.value.trim())
  if (
    preset &&
    checkSelect.value !== 'none' &&
    checkSelect.value !== preset.check
  ) {
    checkSelect.value = preset.check
  }
}

async function start() {
  const prompt = promptBox.value.trim()
  if (!prompt) {
    return showError(notice, new Error('Type a prompt first.'))
  }

  matchCheckToPrompt()

  if (!picker.hasKey()) {
    return missingKeyNote(notice)
  }

  const count = Math.min(
    maxRuns,
    Math.max(1, Math.round(Number(runsInput.value) || 20)),
  )
  runsInput.value = String(count)

  const temperature =
    tempInput.value === '' || effort !== 'none'
      ? undefined
      : Number(tempInput.value)
  const check = checkSelect.value
  const input = { prompt, check, effort, temperature, ...picker.value() }
  notice.replaceChildren()

  const id = ++batch
  results = new Array(count).fill(null)
  const rows = document.getElementById('rows')
  rows.replaceChildren(...results.map((_, i) => runRow(i, null)))

  document.getElementById('runs-box').hidden = false
  document.getElementById('runs-title').textContent =
    `Each run · ${plural(count, 'row')}: answer, check, usage`
  document.getElementById('raw').hidden = true

  render(check, count)

  // One call per run, at most maxParallel at once. Each row fills as its answer arrives.
  let next = 0
  async function worker() {
    while (next < count) {
      const i = next++
      try {
        results[i] = { ok: true, run: await call('run', input) }
      } catch (error) {
        results[i] = { ok: false, error: error.message }
        if (error.missingKey) {
          showError(notice, error)
        }
      }

      if (id !== batch) {
        return
      }

      rows.children[i].replaceWith(runRow(i, results[i]))
      render(check, count)

      // Show the exact request and response of the first answer that arrives.
      const raw = document.getElementById('raw')
      if (results[i].ok && raw.hidden) {
        const fold = (label, value) =>
          el(
            'details',
            { class: 'mx-details' },
            el(
              'summary',
              {},
              el('span', { class: 'mx-label' }, `${label} · run ${i + 1}`),
            ),
            codeBlock(prettyJson(value), 'json'),
          )
        raw.replaceChildren(
          fold('Request sent', results[i].run.request),
          fold('Response received', results[i].run.response),
        )
        raw.hidden = false
      }
    }
  }

  await busy(button, 'Running…', () =>
    Promise.all(Array.from({ length: Math.min(maxParallel, count) }, worker)),
  )
}

function setEffort(value) {
  effort = value
  for (const b of document.getElementById('efforts').children) {
    b.setAttribute('aria-pressed', String(b.dataset.effort === value))
  }

  // GPT-6 takes temperature only when reasoning is off.
  tempInput.disabled = value !== 'none'
  document.getElementById('temp-hint').textContent =
    value === 'none'
      ? '0 to 2. Empty: the model default.'
      : 'Works only with effort none.'
}

function runLabel() {
  const n = Math.min(
    maxRuns,
    Math.max(1, Math.round(Number(runsInput.value) || 1)),
  )

  button.textContent = `Run ${n} ${n === 1 ? 'time' : 'times'}`
  document
    .getElementById('empty')
    .replaceChildren(
      'Press ',
      el('b', {}, button.textContent),
      `. ${plural(n, 'request')}, ${Math.min(n, maxParallel)} at a time. At effort none or low, under 1 cent.`,
    )
}

function usePreset(preset) {
  promptBox.value = preset.prompt
  checkSelect.value = preset.check

  if (!button.disabled) {
    start()
  }
}

const picker = await providerPicker(document.getElementById('picker'))
if (!picker.hasKey()) {
  missingKeyNote(notice)
}

runsInput.max = String(maxRuns)
document.getElementById('runs-hint').textContent = `1 to ${maxRuns}.`
promptBox.value = presets[0].prompt
checkSelect.append(
  ...Object.entries(checks).map(([value, label]) =>
    el('option', { value }, label),
  ),
)
checkSelect.value = presets[0].check

document.getElementById('efforts').append(
  ...efforts.map((value) =>
    el(
      'button',
      {
        type: 'button',
        'data-effort': value,
        onclick: () => setEffort(value),
      },
      value,
    ),
  ),
)

setEffort('low')

document.getElementById('presets').append(
  ...presets.map((p) =>
    el(
      'button',
      {
        class: 'mx-chip',
        type: 'button',
        title: p.prompt,
        onclick: () => usePreset(p),
      },
      p.label,
    ),
  ),
)

render(checkSelect.value, Number(runsInput.value))

runsInput.addEventListener('input', runLabel)
promptBox.addEventListener('input', matchCheckToPrompt)
checkSelect.addEventListener('change', matchCheckToPrompt)
runLabel()

button.addEventListener('click', start)
promptBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    if (!button.disabled) {
      start()
    }
  }
})
