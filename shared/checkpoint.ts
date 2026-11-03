// Some lessons build one larger project in its own repository: a retail
// customer service agent made with Mastra. Each lesson has a checkpoint of it
// on its own branch. The lesson's folder here is a link, and its entry prints
// where the checkpoint lives and the commands that start it.
import { section } from './print.ts'

const REPO = 'https://github.com/angiejones/mega-course-agents'

export interface Checkpoint {
  /** The branch that holds this lesson's state of the project. */
  branch: string
  /** The keys that go into the project's .env.local. */
  keys: string[]
  /** The commands that start it, after the install. */
  start: string[]
  /** The project's walkthrough for this lesson: a path in the repository. */
  guide: string
}

/** The commands that clone the checkpoint and start it, in order. */
export function checkpointSteps(checkpoint: Checkpoint): string[] {
  const folder = REPO.split('/').at(-1)
  const keys = checkpoint.keys.join(' and ')

  return [
    `git clone --branch ${checkpoint.branch} ${REPO}.git`,
    `cd ${folder}`,
    'npm ci   # Node 22.23.3, as in .nvmrc',
    `cp .env.example .env.local   # then add your ${keys}`,
    ...checkpoint.start,
  ]
}

/** Prints the checkpoint's link, the commands that start it and its guide. */
export function printCheckpoint(checkpoint: Checkpoint): void {
  const { branch, guide } = checkpoint

  section('Code')
  console.log(`${REPO}/tree/${branch}`)

  section('Start it')
  for (const step of checkpointSteps(checkpoint)) {
    console.log(step)
  }

  section('Guide')
  console.log(`${REPO}/blob/${branch}/${guide}`)
}
