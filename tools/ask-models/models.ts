import type { ProviderId } from '#shared/providers.ts'

// The models that ask-models compares when you do not pass --models.
// Examples never name models: their defaults live in shared/providers.ts.
// This tool is the one exception, because comparing models is its job.
// Checked in OpenRouter's public model list on 5 October 2026.
export const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  // One model from each of four labs, so the answers come from different training.
  openrouter: [
    'openai/gpt-6-luna',
    'anthropic/claude-haiku-4.5',
    'google/gemini-3.8-flash',
    'x-ai/grok-4.7',
  ],
  // OpenAI serves only its own models: a small one and a large one.
  openai: ['gpt-6-luna', 'gpt-6-sol'],
}
