// Load the patched modules in a fresh worker and replay the listener's actions.
// The fixed test playlist and seed live outside the agent's editable files.
import { isObject } from '#shared/json-schema.ts'
import type { ShownRequest, Usage } from '#shared/llm.ts'
import { runCode } from '#shared/sandbox.ts'
import { CODE, MAP, type Mode, STEPS } from './music.ts'

export type Files = Record<string, string>
export interface Run {
  mode: Mode
  replay: Replay
  openedQueue: boolean
  ranVerify: boolean
  addedKeepInMind: boolean
  filesRead: string[]
  changes: { path: string; before: string; after: string }[]
  steps: number
  stepsToFix: number | null
  actions: { name: string; target: string; replay?: unknown }[]
  answer: string
  usage: Usage
  traffic: { request: ShownRequest; response: unknown }[]
}
export interface Replay {
  played: string[]
  repeats: number
  edited: boolean
  error: string | null
}
const TRACKS = ['Amber', 'Blue', 'Coral', 'Dusk', 'Echo', 'Frost']
const EDITED = TRACKS.filter((track) => track !== 'Blue')

export async function replay(files: Files, steps: string[]): Promise<Replay> {
  if (
    !steps.length ||
    steps.length > 8 ||
    steps.some((step) => !['edit', 'shuffle', 'play 5'].includes(step))
  ) {
    return failure('Use edit, shuffle and play 5 (up to 8 steps).')
  }
  const modules = Object.keys(CODE)
    .map(
      (path) =>
        `${JSON.stringify(path)}: (module, require) => {\n${files[path]}\n}`,
    )
    .join(',\n')
  const result = await runCode(
    `
const modules = { ${modules} };
const loaded = {};
function require(path) {
  if (!modules[path]) { throw new Error('Unknown module ' + path); }
  if (!loaded[path]) {
    const module = { exports: {} };
    loaded[path] = module;
    modules[path](module, require);
  }
  return loaded[path].exports;
}
const store = require('playlists/store.js');
const queue = require('queue/state.js');
const player = require('routes/player.js');
const playlist = require('routes/playlist.js');
require('app/subscriptions.js').connect();
store.create('studio-session', 'Studio Session', data.tracks);
queue.rebuild('studio-session', store.get('studio-session').tracks);
player.pressShuffle();
const played = [];
for (const step of data.steps) {
  if (step === 'edit') { playlist.removeTrack('studio-session', 'Blue'); }
  if (step === 'shuffle') { player.pressShuffle(); }
  if (step === 'play 5') { played.push(...player.pressPlay(5)); }
}
return {
  played, id: store.get('studio-session').id,
  tracks: queue.state.tracks, saved: store.get('studio-session').tracks,
};`,
    { data: { steps, tracks: TRACKS } },
  )
  if (result.error) {
    return failure(result.error)
  }
  return score(result.value, steps.includes('edit'))
}

function failure(error: string): Replay {
  return { played: [], repeats: 0, edited: false, error }
}

function score(value: unknown, edited: boolean): Replay {
  if (
    !isObject(value) ||
    !Array.isArray(value.played) ||
    !value.played.every((track) => typeof track === 'string')
  ) {
    return failure('The app did not return tracks.')
  }
  const played: string[] = value.played
  const expected = edited ? EDITED : TRACKS
  const sameTracks = (tracks: unknown) =>
    Array.isArray(tracks) &&
    tracks.length === expected.length &&
    expected.every((track) => tracks.includes(track))
  if (
    value.id !== 'studio-session' ||
    !sameTracks(value.tracks) ||
    !sameTracks(value.saved) ||
    played.some((track) => !expected.includes(track))
  ) {
    return failure(
      'The edit must preserve the playlist ID and its remaining tracks.',
    )
  }

  return {
    played,
    repeats: played.length - new Set(played).size,
    edited,
    error: null,
  }
}

export function passes(row: { replay: Replay }): boolean {
  return (
    !row.replay.error &&
    row.replay.edited &&
    row.replay.played.length === 5 &&
    row.replay.repeats === 0
  )
}

export type Outcome = 'pass' | 'fail' | 'unfinished'

export function outcome(row: Pick<Run, 'answer' | 'replay'>): Outcome {
  if (!row.answer.trim()) {
    return 'unfinished'
  }

  return passes(row) ? 'pass' : 'fail'
}

// Replay every saved write, even after a fix; retain the first passing step.
// This observation is private: it is never a tool result.
export async function firstFix(
  files: Files,
  step: number,
  first: number | null,
) {
  const result = await replay(files, STEPS)

  return first ?? (passes({ replay: result }) ? step : null)
}

export function newKeepInMind(files: Files): boolean {
  const before = MAP['map/queue.md'].split('## Keep in mind\n')[1]
  const after = files['map/queue.md']?.split('## Keep in mind\n')[1]
  if (!after) {
    return false
  }
  const oldLines = new Set(before.split('\n').map((line) => line.trim()))

  return after
    .split(/\n## |\n# /)[0]
    .split('\n')
    .some((line) => line.trim().length > 0 && !oldLines.has(line.trim()))
}
