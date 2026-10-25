// Context window sizes, in tokens, from OpenRouter's public model list
// (https://openrouter.ai/api/v1/models, field `context_length`), checked
// October 2026. These are reference numbers for the bar. This example does
// not call these models; --measure uses the provider's default model.
export interface ContextWindow {
  model: string
  tokens: number
}

export const WINDOWS: ContextWindow[] = [
  { model: 'openai/gpt-6-luna', tokens: 1_050_000 },
  { model: 'google/gemini-3.8-flash', tokens: 1_048_576 },
  { model: 'anthropic/claude-haiku-4.5', tokens: 200_000 },
  { model: 'meta-llama/llama-3.1-8b-instruct', tokens: 131_072 },
]
