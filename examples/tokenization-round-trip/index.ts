// Tokenization round trip
// Run: npx mex run tokenization-round-trip ["your text"]
import { runCli } from '#shared/cli.ts'
import { bold, dim, green, red, section } from '#shared/print.ts'
import {
  ENCODING_NAMES,
  type Token,
  type Tokenized,
  tokenize,
  tokenLabel,
} from './tokenize.ts'

function main() {
  // The whole command line is the text, so a word like --x is text too.
  const text = process.argv.slice(2).join(' ') || 'Hey, how are you?'
  console.log(`${bold('Text:')} ${JSON.stringify(text)}`)

  for (const encoding of ENCODING_NAMES) {
    const result = tokenize(text, encoding)
    section(`${encoding} ${dim(`(used by ${result.usedBy})`)}`)

    const size = `${result.characters} characters (${result.bytes} bytes)`
    console.log(`${size} → ${result.ids.length} tokens`)
    console.log(`Token IDs: [${result.ids.join(', ')}]\n`)

    console.log(dim('  #  ID      token'))
    result.tokens.forEach(printToken)

    printDecoded(result)
  }
}

function printToken(token: Token, i: number) {
  // <F0 9F> marks bytes of a character that this token splits.
  const done = token.completes ? dim(`  completes ${token.completes}`) : ''
  const label = JSON.stringify(tokenLabel(token))
  console.log(
    `${String(i).padStart(3)}  ${String(token.id).padEnd(6)}  ${label}${done}`,
  )
}

// Token IDs → text. The round trip must give back the exact input.
function printDecoded(result: Tokenized) {
  const check = result.roundTrip
    ? green('(same as input)')
    : red('(not the same as input)')
  console.log(`\nDecoded text: ${JSON.stringify(result.decoded)} ${check}`)
}

await runCli(main)
