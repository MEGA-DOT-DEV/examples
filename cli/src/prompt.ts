import { createInterface } from 'node:readline'

export interface Asker {
  /** Asks a question. In a terminal, the answer is not shown. */
  ask: (question: string) => Promise<string>
  close: () => void
}

/** Reads one line from a raw-mode terminal and echoes nothing. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process
  stdout.write(question)
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  stdin.resume()
  return new Promise((resolve) => {
    let value = ''
    const finish = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      resolve(value)
    }
    const onData = (chunk: string) => {
      // Drop escape sequences such as arrow keys and paste brackets.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matches raw terminal input, which starts with ESC.
      for (const ch of chunk.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '')) {
        if (ch === '\r' || ch === '\n' || (ch === '\u0004' && value === '')) {
          return finish()
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          stdout.write('\nCancelled. Nothing was written.\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1)
        } else if (ch >= ' ') {
          value += ch
        }
      }
    }
    stdin.on('data', onData)
  })
}

/**
 * Hidden input in a terminal. With piped input (tests, scripts), it reads
 * one line per question. It never prints an answer.
 */
export function createAsker(): Asker {
  if (process.stdin.isTTY) {
    return { ask: askHidden, close: () => {} }
  }
  const rl = createInterface({ input: process.stdin, terminal: false })
  const lines = rl[Symbol.asyncIterator]()
  return {
    ask: async (question) => {
      process.stdout.write(question)
      const next = await lines.next()
      process.stdout.write('\n')
      return next.done ? '' : next.value
    },
    close: () => rl.close(),
  }
}
