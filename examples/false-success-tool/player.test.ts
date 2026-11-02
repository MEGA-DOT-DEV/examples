import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  type mock as helpers,
  lastUserText,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: the module loads after this line (dynamic import), so #shared/env.ts never reads a real key.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { musicService, playTrack, runPlayer } = await import('./player.ts')

let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
  undo = useMockEnv(mock)
})
after(async () => {
  undo()
  await mock.close()
})

test('on a held speaker, only the checking play_track sees that nothing plays', () => {
  const trusting = musicService(true)
  assert.deepEqual(playTrack('trust', trusting, 'Interstellar'), {
    status: 200,
  })
  assert.equal(trusting.state().playing, null)

  const checking = musicService(true)
  const failed = playTrack('check', checking, 'Interstellar')
  assert.ok('ok' in failed && failed.ok === false)
  checking.transfer('Built-in player')
  assert.deepEqual(playTrack('check', checking, 'Interstellar'), {
    ok: true,
    playing: 'Interstellar',
    device: 'Built-in player',
  })
})

type Item = { type: string; name?: string; output?: string }

// A model that believes its tool: 200 or ok:true means "playing", and it follows a hint to transfer.
function believer(request: MockRequest, m: typeof helpers) {
  const track = /Play "(.+)"/.exec(lastUserText(request.body))![1]
  const items: Item[] = request.body.input
  const lastCall = items.filter((i) => i.type === 'function_call').at(-1)?.name
  const last = items
    .filter((i) => i.type === 'function_call_output')
    .map((i) => JSON.parse(i.output!))
    .at(-1)
  if (!last || lastCall === 'transfer_playback') {
    return m.response(request, [m.functionCall('play_track', { track })])
  }
  if (last.hint) {
    return m.response(request, [
      m.functionCall('transfer_playback', { device: 'Built-in player' }),
    ])
  }
  const playing = last.ok ?? last.status === 200
  return m.text(
    request,
    JSON.stringify({
      playing,
      message: playing ? `Playing ${track}.` : 'It did not start.',
    }),
  )
}

test('a model that believes 200 makes false claims only when the tool trusts the status', async () => {
  mock.respond = believer
  const trust = await runPlayer('trust')
  assert.deepEqual(
    trust.rows.filter((r) => r.verdict === 'false claim').map((r) => r.title),
    ['Interstellar', 'Last Train', 'Comet Trail'],
  )
  assert.equal(mock.requests[0].body.text.format.type, 'json_schema')

  const check = await runPlayer('check')
  assert.equal(check.falseClaims, 0)
  assert.deepEqual(
    check.rows.filter((r) => r.locked).map((r) => `${r.player} on ${r.device}`),
    [
      'Interstellar on Built-in player',
      'Last Train on Built-in player',
      'Comet Trail on Built-in player',
    ],
  )
})
