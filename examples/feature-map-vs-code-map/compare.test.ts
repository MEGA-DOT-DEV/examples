import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  type mock as helpers,
  type MockLlm,
  type MockRequest,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// Import after setting the environment so no real credentials can load.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MAX_STEPS, runMode } = await import('./compare.ts')
const { outcome, passes, replay } = await import('./replay.ts')
const { CODE, MAP, STEPS } = await import('./music.ts')

const fixed = {
  ...CODE,
  'queue/state.js': CODE['queue/state.js'].replace(
    'state.tracks = [...tracks];',
    'state.tracks = [...tracks];\n  orders.clear(id);',
  ),
}

test('the cached six-index order repeats after the five-track edit', async () => {
  const result = await replay(CODE, STEPS)
  assert.deepEqual(result.played, ['Amber', 'Coral', 'Dusk', 'Echo', 'Amber'])
  assert.equal(result.repeats, 1)
  assert.equal(result.edited, true)
})

test('clearing the queue cache removes repeats; editing playlists alone does not', async () => {
  const repaired = await replay(fixed, STEPS)
  assert.equal(repaired.repeats, 0)
  assert.equal(repaired.played.length, 5)
  assert.equal(repaired.edited, true)

  for (const replacement of [
    'list.tracks = [...new Set(tracks)];',
    'list.tracks = tracks.slice();',
    "list.tracks = [...tracks];\n  events.emit('playlist:saved', id);",
  ]) {
    const playlistOnly = {
      ...CODE,
      'playlists/edit.js': CODE['playlists/edit.js'].replace(
        'list.tracks = [...tracks];',
        replacement,
      ),
    }
    assert.equal((await replay(playlistOnly, STEPS)).repeats, 1)
  }
})

test('invalid replay, absent edit, and broken code cannot score as a fix', async () => {
  assert.equal((await replay(fixed, ['play 5'])).edited, false)
  assert.match((await replay(fixed, ['play 500'])).error ?? '', /Use edit/)
  assert.match(
    (await replay({ ...CODE, 'queue/state.js': 'broken (' }, STEPS)).error ??
      '',
    /SyntaxError/,
  )
})

test('a playlist id change cannot disguise stale queue state', async () => {
  const changedId = {
    ...CODE,
    'playlists/edit.js': CODE['playlists/edit.js'].replace(
      'list.tracks = [...tracks];',
      "list.id = 'fresh-id';\n  list.tracks = [...tracks];",
    ),
  }
  // The immutable ID remains the same: the stale cached order still repeats.
  assert.equal((await replay(changedId, STEPS)).repeats, 1)
  assert.equal(passes({ replay: await replay(CODE, STEPS) }), false)
  assert.equal(passes({ replay: await replay(fixed, ['play 5']) }), false)
})

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

function codingAgent(request: MockRequest, m: typeof helpers) {
  const calls = request.body.input.filter(
    (item: { type: string }) => item.type === 'function_call',
  ).length
  const actions = [
    m.functionCall('read_file', { path: 'map/playlist.md' }),
    m.functionCall('read_file', { path: 'map/queue.md' }),
    m.functionCall('read_file', { path: 'queue/state.js' }),
    m.functionCall('run_scenario', { steps: STEPS }),
    m.functionCall('write_file', {
      path: 'queue/state.js',
      content: fixed['queue/state.js'],
    }),
    m.functionCall('run_scenario', { steps: STEPS }),
    m.functionCall('write_file', {
      path: 'map/queue.md',
      content: `${MAP['map/queue.md']}Shuffle order is cached.\n`,
    }),
  ]
  if (calls < actions.length) {
    return m.response(request, [actions[calls]])
  }
  return m.text(request, 'Cleared the queue cache and recorded the hazard.')
}

test('a feature-map agent follows the queue link, verifies, fixes and records it', async () => {
  mock.respond = codingAgent
  const result = await runMode('feature map')
  assert.equal(passes(result), true)
  assert.equal(result.stepsToFix, 5)
  assert.equal(outcome(result), 'pass')
  assert.equal(result.replay.repeats, 0)
  assert.equal(result.openedQueue, true)
  assert.equal(result.ranVerify, true)
  assert.equal(result.addedKeepInMind, true)
  assert.deepEqual(
    result.changes.map((change) => change.path),
    ['queue/state.js', 'map/queue.md'],
  )
})

test('first passing write stays private and survives later repairs or regressions', async () => {
  for (const lastSource of [CODE['queue/state.js'], fixed['queue/state.js']]) {
    const patches = [
      CODE['queue/state.js'],
      fixed['queue/state.js'],
      lastSource,
    ]
    mock.respond = (request, m) => {
      const outputs = request.body.input.filter(
        (item: { type: string }) => item.type === 'function_call_output',
      )
      // A private scoring run must not give the agent feedback or count as verify.
      for (const item of outputs) {
        assert.deepEqual(JSON.parse(item.output), { saved: 'queue/state.js' })
      }
      if (outputs.length === patches.length) {
        return m.text(request, 'Finished editing.')
      }
      return m.response(request, [
        m.functionCall('write_file', {
          path: 'queue/state.js',
          content: patches[outputs.length],
        }),
      ])
    }
    const result = await runMode('no map')
    assert.equal(result.stepsToFix, 2)
    assert.equal(result.ranVerify, false)
    assert.equal(passes(result), lastSource === fixed['queue/state.js'])
    assert.equal(
      outcome(result),
      lastSource === fixed['queue/state.js'] ? 'pass' : 'fail',
    )
  }
})

test('an unrepaired run reports no first fix rather than zero steps', async () => {
  mock.respond = (request, m) => m.text(request, 'No change.')
  const result = await runMode('no map')
  assert.equal(result.stepsToFix, null)
  assert.equal(passes(result), false)
  assert.equal(outcome(result), 'fail')
})

test('a passing patch without a final answer is unfinished at the request limit', async () => {
  mock.respond = (request, m) => {
    const calls = request.body.input.filter(
      (item: { type: string }) => item.type === 'function_call',
    ).length
    if (calls === 0) {
      return m.response(request, [
        m.functionCall('write_file', {
          path: 'queue/state.js',
          content: fixed['queue/state.js'],
        }),
      ])
    }
    return m.response(request, [
      m.functionCall('read_file', { path: 'queue/state.js' }),
    ])
  }
  const result = await runMode('no map')
  assert.equal(result.steps, MAX_STEPS)
  assert.equal(result.stepsToFix, 1)
  assert.equal(passes(result), true)
  assert.equal(outcome(result), 'unfinished')
})
