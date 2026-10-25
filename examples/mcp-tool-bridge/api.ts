import { providerInput } from '#shared/llm.ts'
import { compare, PROJECTS } from './bridge.ts'

export function setup() {
  return { projects: PROJECTS }
}

export function run(input: {
  project?: unknown
  provider?: unknown
  model?: unknown
}) {
  if (
    typeof input?.project !== 'string' ||
    !PROJECTS.includes(input.project.toLowerCase())
  ) {
    throw new Error(`Choose a project: ${PROJECTS.join(', ')}.`)
  }

  return compare({ project: input.project, ...providerInput(input) })
}
