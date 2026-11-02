// Did the track play?
// Run: npx mex run false-success-tool [trust|check]
//      [--provider openrouter|openai] [--model id]
import { cliArgs, runCli } from '#shared/cli.ts'
import { oneOf } from '#shared/input.ts'
import { costText, pickProvider } from '#shared/llm.ts'
import { printRequest } from '#shared/print.ts'
import {
  type Answer,
  type CaseResult,
  cases,
  MODES,
  type Mode,
  runPlayer,
} from './player.ts'

const MODE_TEXT: Record<Mode, string> = {
  trust: 'Trust the status: play_track returns the service status.',
  check: 'Check the player: play_track reads the player state after play.',
}

async function main() {
  const { flags, words } = cliArgs()
  const mode = oneOf(words[0], MODES, 'mode') ?? 'trust'

  // Check the key before the first output.
  pickProvider(flags.provider)

  console.log(MODE_TEXT[mode])
  const result = await runPlayer(mode, flags)
  result.rows.forEach(printCase)

  const claims = `${result.falseClaims} false claims in ${cases.length} requests`
  console.log(`\n${claims} · ${costText(result.usage)}`)
}

/** One track: the requests, the tool calls, the claim and the real player. */
function printCase(row: CaseResult, index: number) {
  const held = row.locked ? ' (speaker holds playback)' : ''
  console.log(`\n${index + 1}. ${row.title}${held}`)

  for (const step of row.traffic) {
    printRequest({ ...step.request, headers: {} })
  }
  for (const call of row.calls) {
    const output = JSON.stringify(call.output)
    console.log(`   ${call.name}(${call.args}) → ${output}`)
  }

  console.log(`   Agent says: ${claimText(row.answer)}`)
  console.log(`   Player: ${row.player} on ${row.device} → ${row.verdict}`)
}

function claimText(answer: Answer | null) {
  if (!answer) {
    return 'no answer'
  }
  const playing = answer.playing ? 'playing' : 'not playing'

  return `${playing} · "${answer.message}"`
}

await runCli(main)
