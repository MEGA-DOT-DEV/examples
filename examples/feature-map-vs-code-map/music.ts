// Sources of an 18-file music app, copied into memory for each agent.
// Escaped newlines keep related short statements together in this fixture;
// read_file shows ordinary JavaScript modules with 15–40 lines each.
export const CODE: Record<string, string> = {
  'app/events.js': `const listeners = new Map();\n
function on(topic, listener) {
  const group = listeners.get(topic) || [];\n  group.push(listener);
  listeners.set(topic, group);\n}\n
function emit(topic, value) {
  for (const listener of listeners.get(topic) || []) {
    listener(value);\n  }\n}\n
module.exports = { on, emit };\n`,
  'app/subscriptions.js': `const events = require('app/events.js');
const store = require('playlists/store.js');
const queue = require('queue/state.js');
const downloads = require('offline/downloads.js');
const history = require('player/history.js');\n
function connect() {
  events.on('playlist:saved', (id) => {
    queue.rebuild(id, store.get(id).tracks);\n  });
  events.on('track:played', (track) => history.record(track));
  events.on('offline:requested', (track) => downloads.save(track));
}\n
module.exports = { connect };\n`,
  'playlists/store.js': `const lists = new Map();\n
function create(id, title, tracks) {
  if (lists.has(id)) { throw new Error('Playlist exists'); }
  const list = { title, tracks: [...tracks] };
  Object.defineProperty(list, 'id', { value: id, enumerable: true });
  lists.set(id, list);\n}\n
function get(id) {
  const list = lists.get(id);
  if (!list) { throw new Error('Unknown playlist'); }
  return list;\n}\n
module.exports = { create, get };\n`,
  'playlists/edit.js': `const store = require('playlists/store.js');
const events = require('app/events.js');\n
function save(id, tracks) {
  const list = store.get(id);\n  list.tracks = [...tracks];
  events.emit('playlist:saved', id);\n  return list;\n}\n
function remove(id, track) {
  const list = store.get(id);
  return save(id, list.tracks.filter((item) => item !== track));\n}\n
module.exports = { save, remove };\n`,
  'playlists/view.js': `const store = require('playlists/store.js');\n
function render(id) {
  const list = store.get(id);\n  return {
    title: list.title,\n    count: list.tracks.length,
    rows: list.tracks.map((track, index) => ({
      track,\n      position: index + 1,\n    })),\n  };\n}\n
module.exports = { render };\n`,
  'queue/state.js': `const orders = require('queue/order-cache.js');
const state = { id: null, tracks: [], position: 0, shuffled: false };\n
function rebuild(id, tracks) {
  state.id = id;\n  state.tracks = [...tracks];\n  state.position = 0;\n}\n
function shuffle() {
  state.shuffled = true;\n  state.position = 0;
  orders.get(state.id, state.tracks.length);\n}\n
module.exports = { state, rebuild, shuffle };\n`,
  'queue/order-cache.js': `const cache = new Map();\n
function get(id, length) {
  if (!cache.has(id)) {
    const seed = [5, 1, 2, 3, 0, 4];
    cache.set(id, seed.filter((index) => index < length));\n  }
  return cache.get(id);\n}\n
function clear(id) {
  cache.delete(id);\n}\n
module.exports = { get, clear };\n`,
  'queue/advance.js': `const { state } = require('queue/state.js');
const orders = require('queue/order-cache.js');\n
function next() {
  if (!state.tracks.length) { throw new Error('Queue is empty'); }
  const order = state.shuffled
    ? orders.get(state.id, state.tracks.length)
    : state.tracks.map((_, index) => index);
  const index = order[state.position % order.length];
  state.position += 1;\n  state.position %= order.length;
  return state.tracks[index % state.tracks.length];\n}\n
module.exports = { next };\n`,
  'player/controls.js': `const queue = require('queue/state.js');
const advance = require('queue/advance.js');
const events = require('app/events.js');\n
function play(count) {
  const played = [];\n  for (let index = 0; index < count; index++) {
    const track = advance.next();\n    played.push(track);
    events.emit('track:played', track);\n  }\n  return played;\n}\n
module.exports = { play, shuffle: queue.shuffle };\n`,
  'player/history.js': `const recent = [];\nconst limit = 20;\n
function record(track) {
  recent.unshift(track);\n  if (recent.length > limit) {
    recent.pop();\n  }\n}\n
function all() {\n  return [...recent];\n}\n
module.exports = { record, all };\n`,
  'offline/store.js': `const files = new Map();\n
function put(track, bytes) {
  files.set(track, { bytes, ready: true });\n}\n
function get(track) {
  return files.get(track) || null;\n}\n
function remove(track) {
  files.delete(track);\n}\n
module.exports = { put, get, remove };\n`,
  'offline/downloads.js': `const store = require('offline/store.js');
const catalog = require('library/catalog.js');\n
function save(track) {
  const item = catalog.find(track);
  if (!item) { throw new Error('Track unavailable'); }
  store.put(track, item.duration * 1024);\n  return store.get(track);\n}\n
function ready(track) {
  return Boolean(store.get(track)?.ready);\n}\n
module.exports = { save, ready };\n`,
  'library/catalog.js': `const titles = ['Amber', 'Blue', 'Coral', 'Dusk', 'Echo', 'Frost'];
const catalog = titles.map((title, index) => ({
  title,\n  artist: 'Studio Session',\n  duration: 180 + index * 10,\n}));\n
function find(title) {
  return catalog.find((track) => track.title === title);\n}\n
function all() {\n  return catalog.map((track) => ({ ...track }));\n}\n
module.exports = { find, all };\n`,
  'library/favorites.js': `const favorites = new Set();\n
function toggle(track) {
  if (favorites.has(track)) {\n    favorites.delete(track);
  } else {\n    favorites.add(track);\n  }
  return favorites.has(track);\n}\n
function all() {\n  return [...favorites];\n}\n
module.exports = { toggle, all };\n`,
  'search/query.js': `const catalog = require('library/catalog.js');\n
function search(text, limit = 10) {
  if (limit < 1) { return []; }
  const query = text.trim().toLowerCase();
  if (!query) {\n    return [];\n  }
  return catalog.all().filter((track) => {
    const words = track.title + ' ' + track.artist;
    return words.toLowerCase().includes(query);
  }).slice(0, limit);\n}\n
module.exports = { search };\n`,
  'settings/preferences.js': `const values = { volume: 0.8, offline: false };\n
function setVolume(value) {
  if (!Number.isFinite(value)) { throw new Error('Invalid volume'); }
  values.volume = Math.max(0, Math.min(1, value));\n}\n
function setOffline(value) {\n  values.offline = Boolean(value);\n}\n
function read() {\n  return { ...values };\n}\n
module.exports = { setVolume, setOffline, read };\n`,
  'routes/playlist.js': `const edit = require('playlists/edit.js');
const view = require('playlists/view.js');\n
function open(id) {\n  return view.render(id);\n}\n
function removeTrack(id, track) {
  edit.remove(id, track);\n  return open(id);\n}\n
function saveTracks(id, tracks) {\n  edit.save(id, tracks);\n}\n
module.exports = { open, removeTrack, saveTracks };\n`,
  'routes/player.js': `const controls = require('player/controls.js');
const preferences = require('settings/preferences.js');\n
function pressPlay(count) {
  const settings = preferences.read();
  if (settings.volume === 0) {\n    return [];\n  }
  return controls.play(count);\n}\n
function pressShuffle() {\n  controls.shuffle();\n}\n
module.exports = { pressPlay, pressShuffle };\n`,
}

export const STEPS = ['edit', 'shuffle', 'play 5']
export const MAP: Record<string, string> = {
  'map/player.md': `# Player
## Role
Plays the next track from the queue.
## How to get there
Open the player screen.
## How to verify
Play a track and check the title.
## Keep in mind
Playback reads the current queue.
`,
  'map/playlist.md': `# Playlist
## Role
Stores the tracks the listener has selected.
## How to get there
Open a playlist and edit its tracks.
## How to verify
Save a change and check the track list.
## Keep in mind
Editing a playlist rebuilds the queue.
`,
  'map/queue.md': `# Queue
## Role
Holds the upcoming tracks and their shuffle order.
## How to get there
Open the player and press shuffle.
## How to verify
Load the test playlist, press shuffle, play 5 tracks. Expect no repeats.
The test playlist is Studio Session: shuffle is already active.
Remove Blue, press shuffle, play 5: ["edit", "shuffle", "play 5"].
## Keep in mind
The queue is rebuilt after a playlist edit.
`,
  'map/offline.md': `# Offline
## Role
Makes downloaded tracks available without a connection.
## How to get there
Download a track and disconnect.
## How to verify
Play that track offline.
## Keep in mind
Offline tracks use the same player.
`,
}

export const CODE_MAP = `# Code map
Routes: routes/playlist.js, routes/player.js.
Folders: app/, player/, playlists/, queue/, offline/, library/, search/, settings/.
`

export const MODES = ['no map', 'code map', 'feature map'] as const
export type Mode = (typeof MODES)[number]
export const HINTS: Record<Mode, string> = {
  'no map': 'There is no map.',
  'code map': 'A code map is in code-map.md.',
  'feature map': 'Feature documents are in map/.',
}
