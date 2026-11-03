import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

process.env.MEX_ENV_FILE = '/nonexistent/.env'
// Dynamic import: MEX_ENV_FILE must be set before #shared/env.ts loads.
const {
  REQUESTS,
  SKILLS,
  imageTool,
  runRequest,
  score,
  skillAbout,
  skillText,
} = await import('./links.ts')
let mock: MockLlm
let undo = () => {}
before(async () => {
  mock = await startMockLlm()
})
after(async () => {
  undo()
  await mock.close()
})
beforeEach(() => {
  undo()
  mock.requests.length = 0
  mock.respond = undefined
})

const pixel = REQUESTS.find(
  (request) => request.skill === 'pixel-art' && request.need === 'style',
)!
const photo = REQUESTS.find((request) => request.need === 'tool')!
const question = REQUESTS.find((request) => request.need === 'skill')!
const PIXEL = { prompt: 'a fox', ...SKILLS[0].args }

test('a styled image passes only with its skill loaded and every argument right', () => {
  assert.equal(score(pixel, ['pixel-art'], PIXEL).pass, true)
  // The right numbers without the skill are a guess, not a pass.
  assert.equal(score(pixel, [], PIXEL).pass, false)
  const wrong = score(pixel, ['pixel-art'], { ...PIXEL, colors: 16 })
  assert.equal(wrong.pass, false)
  assert.deepEqual(
    wrong.checks
      .filter((check) => !check.pass)
      .map((check) => [check.name, check.got, check.want]),
    [['colors', 16, 12]],
  )
})

test('a link does not force the pair: the photo needs the tool alone, the question the skill alone', () => {
  assert.equal(score(photo, [], { ...PIXEL, width: 1024 }).pass, true)
  assert.equal(score(photo, ['pixel-art'], PIXEL).pass, false)
  assert.equal(score(question, ['pixel-art'], null).pass, true)
  assert.equal(score(question, ['pixel-art'], PIXEL).pass, false)
})

test('only the linked mode names the other side', () => {
  for (const skill of SKILLS) {
    assert.doesNotMatch(
      `${skillAbout(skill.id, 'unlinked')} ${skillText(skill.id, 'unlinked')}`,
      /generate_image|width \d/,
    )
    assert.match(
      skillText(skill.id, 'linked'),
      new RegExp(
        `generate_image.*width ${skill.args.width}, height ${skill.args.height}, colors ${skill.args.colors}, smoothing ${skill.args.smoothing}`,
      ),
    )
  }
  assert.doesNotMatch(imageTool('unlinked').description!, /skill/)
  assert.match(
    imageTool('linked').description!,
    /pixel-art, blueprint, watercolor/,
  )
})

test('a run records the loaded skill and the arguments that reached the stub', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (request, m) => {
    const outputs = (request.body.input as { type?: string }[]).filter(
      (item) => item.type === 'function_call_output',
    ).length
    if (outputs === 0) {
      return m.response(request, [
        m.functionCall('load_skill', { id: 'pixel-art' }),
      ])
    }
    return m.response(request, [m.functionCall('generate_image', PIXEL)])
  }
  const run = await runRequest('linked', REQUESTS.indexOf(pixel))
  assert.deepEqual(run.outcome.loaded, ['pixel-art'])
  assert.deepEqual(run.outcome.call, PIXEL)
  assert.equal(run.outcome.pass, true)
  // The loop stops once the image call happened: no request for a closing text.
  assert.equal(mock.requests.length, 2)
  assert.match(
    String(
      (mock.requests[1].body.input as { output?: string }[]).at(-1)?.output,
    ),
    /generate_image/,
  )
})
