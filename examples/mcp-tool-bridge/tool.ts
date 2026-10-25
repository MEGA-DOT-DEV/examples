export const DIRECTORY = {
  atlas: { owner: 'Mira', route: 'west' },
  cedar: { owner: 'Jules', route: 'north' },
  ember: { owner: 'Nia', route: 'east' },
} as const

export const schema = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Project name: atlas, cedar or ember',
    },
  },
  required: ['project'],
  additionalProperties: false,
}

export function lookup(project: unknown) {
  if (
    typeof project !== 'string' ||
    !Object.hasOwn(DIRECTORY, project.toLowerCase())
  ) {
    return { error: 'Choose a project: atlas, cedar or ember.' }
  }

  const key = project.toLowerCase() as keyof typeof DIRECTORY
  return { project: key, ...DIRECTORY[key] }
}
