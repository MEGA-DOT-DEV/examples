// The files that ship in a new workspace. A new seed file needs one import and
// one entry here.

import agenda from './documents/agenda.md'
import attentionBudget from './documents/attention-budget.md'
import focus from './documents/focus.md'
import researcher from './documents/instances/researcher.md'
import specter from './documents/instances/specter.md'
import openAsks from './documents/open-asks.md'
import watches from './documents/watches.md'
import durableExecution from './notes/durable-execution.md'
import learningAgents from './notes/learning-agents.md'
import digest from './skills/digest.md'
import firstLook from './skills/first-look.md'
import guide from './skills/guide.md'
import linkToNote from './skills/link-to-note.md'
import reflection from './skills/reflection.md'

export const SEED = {
  'skills/guide.md': guide,
  'documents/instances/specter.md': specter,
  'documents/instances/researcher.md': researcher,
  'skills/first-look.md': firstLook,
  'skills/link-to-note.md': linkToNote,
  'skills/digest.md': digest,
  'skills/reflection.md': reflection,
  'documents/focus.md': focus,
  'documents/watches.md': watches,
  'documents/agenda.md': agenda,
  'documents/attention-budget.md': attentionBudget,
  'documents/open-asks.md': openAsks,
  'notes/durable-execution.md': durableExecution,
  'notes/learning-agents.md': learningAgents,
} satisfies Readonly<Record<string, string>>
