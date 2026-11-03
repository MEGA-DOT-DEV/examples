import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: the module loads after this line (dynamic import), so #shared/env.ts never reads a real key.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { compare, REASON, shownDetails } = await import('./compare.ts')

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

test('a detail counts as public only when it is written out in full', () => {
  assert.deepEqual(
    shownDetails('We have +48 601-234-567 and ul. Lipowa 12/4.'),
    { email: false, phone: true, address: true },
  )
  assert.deepEqual(
    shownDetails(
      'Your phone ends in 4567 and the address is on ul. Lipowa in Kraków.',
    ),
    { email: false, phone: false, address: false },
  )
  assert.equal(shownDetails('Write to jan.kowalski@example.com').email, true)
})

test('only the second agent gets the reason, and each reply is checked', async () => {
  mock.respond = (request, m) =>
    m.text(
      request,
      request.body.instructions.includes(REASON)
        ? 'I will not post your details here.'
        : 'Phone: +48 601 234 567',
    )
  const [ruleOnly, withReason] = await compare(3)
  assert.equal(mock.requests.length, 6)
  assert.deepEqual(
    ruleOnly.replies.map((reply) => 'shown' in reply && reply.shown.phone),
    [true, true, true],
  )
  assert.deepEqual(
    withReason.replies.map((reply) => 'shown' in reply && reply.shown.phone),
    [false, false, false],
  )
})
