// Responses API request
// Run: npx mex run responses-request ["your prompt"]
//      [--provider openrouter|openai] [--model id]
//
// This example makes the request by hand, with fetch, so you see every part.
// The other examples use the same request through shared/llm.ts.
import { cliArgs, runCli } from '#shared/cli.ts'
import { getKey } from '#shared/env.ts'
import { pickProvider } from '#shared/llm.ts'
import {
  bold,
  dim,
  printRequest,
  printResponse,
  section,
} from '#shared/print.ts'
import { baseUrl, model, PROVIDERS } from '#shared/providers.ts'

async function main() {
  const { flags, words } = cliArgs()

  // OpenRouter if its key is set, otherwise OpenAI. --provider picks one.
  const provider = pickProvider(flags.provider)
  const spec = PROVIDERS[provider]

  const url = `${baseUrl(provider)}/responses`
  const headers = {
    'Content-Type': 'application/json',
    ...spec.auth(getKey(spec.envKey)),
  }

  // A small valid body: a model and an input. store: false keeps nothing on
  // the provider's side (OpenRouter's Responses API requires it).
  const body = {
    model: flags.model ?? model(provider),
    input: words.join(' ') || 'Hey, how are you?',
    store: false,
  }

  printRequest({ method: 'POST', url, headers, body })

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await response.json()

  printResponse(response.status, data)
  if (!response.ok) {
    process.exitCode = 1
    return
  }

  section('Text from output')
  console.log(dim('output[] → message → content[] → output_text'))
  console.log(bold(outputText(data)))
}

// The SDKs add an `output_text` helper. In raw JSON, the text sits in
// output[] → message → content[] → output_text.
type OutputItem = { type: string; content?: { type: string; text?: string }[] }

function outputText(data: { output: OutputItem[] }) {
  return data.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
}

await runCli(main)
