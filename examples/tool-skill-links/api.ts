// Functions that the browser page (ui/) calls through `npx mex open`.
// The page calls run() once per mode, so each column fills as it finishes.
import { byId } from '#shared/input.ts'
import { providerInput } from '#shared/llm.ts'
import {
  INSTRUCTIONS,
  imageTool,
  MODES,
  REQUESTS,
  runMode,
  SKILLS,
  skillAbout,
  skillText,
} from './links.ts'

export function setup() {
  return {
    instructions: INSTRUCTIONS,
    requests: REQUESTS,
    skills: SKILLS,
    modes: MODES.map((mode) => ({
      ...mode,
      tool: imageTool(mode.id).description,
      skills: SKILLS.map((skill) => ({
        id: skill.id,
        about: skillAbout(skill.id, mode.id),
        text: skillText(skill.id, mode.id),
      })),
    })),
  }
}

export async function run(input: {
  mode?: unknown
  provider?: unknown
  model?: unknown
}) {
  const mode = byId(MODES, input.mode, 'mode')
  if (!mode) {
    throw new Error('Send a mode.')
  }

  return runMode(mode.id, providerInput(input))
}
