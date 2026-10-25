// What the skills cost in the context, for three ways to give them to a model.
// Local token counts only, no model call.
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import type { Skill } from './catalog.ts'
import { loadSkillTool, skillList } from './select.ts'

// o200k_base is the public tokenizer of recent OpenAI models. Other models
// count a little differently, so read the numbers as sizes, not exact bills.
export const count = (text: string) =>
  text ? encode(text, { disallowedSpecial: new Set() }).length : 0

export const ROUTER_NAME = 'dev-skills'

/** A router skill: a short entry up front, and a body that maps tasks to sub-skills. */
export function routerSkill(skills: Skill[]): Skill {
  return {
    name: ROUTER_NAME,
    description: `Coding tasks: ${skills.map((s) => s.name).join(', ')}. Load it for a coding task that may need one of them. It says which sub-skill to load.`,
    body: `# Dev skills\n\nPick the one sub-skill that fits the request and load it with load_skill. When none fits, answer directly.\n\n${skillList(skills)}`,
  }
}

export type StrategyId = 'all-bodies' | 'on-demand' | 'router'

export interface Strategy {
  id: StrategyId
  label: string
  /** In every request, before the model decides anything. */
  upfront: { tokens: number; text: string }
  /** Added for this one request, as load_skill results. */
  loaded: { tokens: number; text: string }
}

const bodyText = (s: Skill) => `## ${s.name}\n${s.description}\n\n${s.body}`

/**
 * The three strategies for one request. `expected` is the skill the request
 * needs (null: none), so the counts assume a correct choice.
 */
export function compareStrategies(
  skills: Skill[],
  expected: string | null,
): Strategy[] {
  const skill = skills.find((s) => s.name === expected) ?? null
  const router = routerSkill(skills)
  const allBodies = skills.map(bodyText).join('\n\n')
  const onDemandTool = JSON.stringify(loadSkillTool(skills))
  const onDemand = `${skillList(skills)}\n\n${onDemandTool}`
  // The tool takes every name, so the router can load a sub-skill by name.
  const routedTool = JSON.stringify(loadSkillTool([router, ...skills]))
  const routed = `${skillList([router])}\n\n${routedTool}`

  const loads = (parts: Skill[]) => {
    const text = parts.map((s) => s.body).join('\n\n')
    return { tokens: count(text), text }
  }

  return [
    {
      id: 'all-bodies',
      label: 'All bodies in the instructions',
      upfront: { tokens: count(allBodies), text: allBodies },
      loaded: loads([]),
    },
    {
      id: 'on-demand',
      label: 'Names and descriptions, load on demand',
      upfront: { tokens: count(onDemand), text: onDemand },
      loaded: loads(skill ? [skill] : []),
    },
    {
      id: 'router',
      label: 'One router skill',
      upfront: { tokens: count(routed), text: routed },
      loaded: loads(skill ? [router, skill] : []),
    },
  ]
}
