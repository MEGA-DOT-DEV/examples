import {
  busy,
  call,
  el,
  formatCost,
  modelText,
  providerPicker,
  requestResponse,
  showError,
} from '../../kit/kit.js'

const picker = await providerPicker(document.getElementById('picker'))
const button = document.getElementById('run')
const mode = document.getElementById('mode')
const hint = document.getElementById('mode-hint')
const result = document.getElementById('result')
const notice = document.getElementById('notice')
const { cases } = await call('setup')

const HINTS = {
  trust: 'play_track sends the command and returns the status code.',
  check: 'play_track sends the command, then reads the player state.',
}
mode.addEventListener('change', () => {
  hint.textContent = HINTS[mode.value]
})

const VERDICT_LABELS = {
  'true claim': 'True claim',
  'false claim': 'False claim',
  'no answer': 'No answer',
}

function summary(rows, ranMode) {
  const falseClaims = rows.filter((row) => row.verdict === 'false claim').length
  const noAnswer = rows.filter((row) => row.verdict === 'no answer').length
  const cost = rows
    .flatMap((row) => row.usage)
    .reduce((sum, usage) => sum + (usage.cost ?? 0), 0)
  const estimated = rows.some((row) =>
    row.usage.some((usage) => usage.costSource === 'estimate'),
  )
  const meaning = meaningOf(falseClaims, ranMode)

  return el(
    'div',
    { class: 'mx-callout' },
    el(
      'strong',
      { class: 'fs-score' },
      `${falseClaims} false ${falseClaims === 1 ? 'claim' : 'claims'} in ${rows.length} requests`,
    ),
    el(
      'p',
      {},
      `${meaning}${noAnswer ? ` ${noAnswer} without an answer.` : ''} ${formatCost(cost)}${estimated ? ' est.' : ''} total.`,
    ),
  )
}

function meaningOf(falseClaims, ranMode) {
  if (falseClaims) {
    return `The agent said “playing” ${falseClaims} ${falseClaims === 1 ? 'time' : 'times'} while the player was stopped. Status 200 did not prove that the track played.`
  }
  if (ranMode === 'check') {
    return 'play_track read the player state, so the agent knew when play failed. Every claim matched the player.'
  }

  return 'Every claim matched the player in this run.'
}

function claimOf(answer) {
  if (!answer) {
    return 'no answer'
  }

  return answer.playing ? 'playing' : 'not playing'
}

function rowView(row, index) {
  if (!row || row.error) {
    return el(
      'article',
      { class: 'mx-plate fs-row' },
      el('strong', {}, `${index + 1}. ${cases[index].title}`),
      el(
        'p',
        { class: 'mx-muted' },
        row ? 'Request failed. See the error above.' : 'Running…',
      ),
    )
  }

  const said = claimOf(row.answer)

  return el(
    'article',
    { class: 'mx-plate fs-row' },
    el(
      'div',
      { class: 'fs-head' },
      el('strong', {}, `${index + 1}. ${row.title}`),
      row.locked
        ? el(
            'span',
            { class: 'mx-chip mx-chip--static' },
            'Speaker holds playback',
          )
        : null,
      el(
        'span',
        {
          class: `fs-verdict ${row.verdict === 'true claim' ? 'mx-good' : 'mx-bad'}`,
        },
        VERDICT_LABELS[row.verdict],
      ),
    ),
    el(
      'p',
      { class: 'fs-state' },
      'Agent says: ',
      el('b', {}, said),
      ' · Player: ',
      el(
        'b',
        {},
        row.player === row.title ? `playing on ${row.device}` : 'stopped',
      ),
    ),
    row.answer ? modelText(row.answer.message, 'fs-reply') : null,
    el(
      'p',
      { class: 'mx-small mx-muted fs-calls' },
      row.calls
        .map((c) => `${c.name} → ${JSON.stringify(c.output)}`)
        .join('\n') || 'No tool call',
    ),
    el(
      'details',
      { class: 'mx-details' },
      el('summary', {}, `Request and response · ${row.traffic.length} steps`),
      ...row.traffic.map((step) =>
        requestResponse(step.request, step.response),
      ),
    ),
  )
}

button.addEventListener('click', () =>
  busy(button, 'Running…', async () => {
    showError(notice, null)
    const ranMode = mode.value
    const rows = cases.map(() => null)
    const done = () => rows.filter((row) => row && !row.error)
    const show = () =>
      result.replaceChildren(
        done().length === cases.length
          ? summary(rows, ranMode)
          : el(
              'p',
              { class: 'mx-muted' },
              `${done().length} of ${cases.length} requests done.`,
            ),
        el('div', { class: 'fs-list' }, ...rows.map(rowView)),
      )
    show()

    // The eight requests are independent: each one gets its own fresh player.
    const settled = await Promise.allSettled(
      cases.map(async (_, index) => {
        try {
          rows[index] = await call('play', {
            index,
            mode: ranMode,
            ...picker.value(),
          })
        } catch (error) {
          rows[index] = { error }
          throw error
        } finally {
          show()
        }
      }),
    )

    const failed = settled.find((outcome) => outcome.status === 'rejected')
    if (failed) {
      showError(notice, failed.reason)
    }
  }),
)
