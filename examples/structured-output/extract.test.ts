import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  lastUserText,
  type MockLlm,
  startMockLlm,
  useMockEnv,
} from '../../cli/test/fixtures/mock-llm.ts'

// No .env: each test sets exactly the keys it needs.
process.env.MEX_ENV_FILE = '/nonexistent/.env'
const { MissingKeyError } = await import('#shared/env.ts')
const { PRESETS, INVENTED_CITY, extract } = await import('./extract.ts')
const { check, readSchema } = await import('./check.ts')
const api = await import('./api.ts')

const kyoto = PRESETS.find((p) => p.id === 'kyoto')!
const invented = PRESETS.find((p) => p.id === 'invented')!
const population = PRESETS.find((p) => p.id === 'population')!

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
  // What a model does in strict mode: JSON in the output text.
  mock.respond = (request, m) => {
    const prompt = lastUserText(request.body)
    if (prompt.includes(INVENTED_CITY)) {
      return m.text(
        request,
        `{"city":"${INVENTED_CITY}","country":"United Kingdom"}`,
      )
    }
    if (prompt.includes('population')) {
      return m.text(
        request,
        '{"city":"Kyoto","country":"Japan","population":1460000}',
      )
    }
    return m.text(request, '{"city":"Kyoto","country":"Japan"}')
  }
})

test('without a key it names both keys and makes no request', async () => {
  undo = useMockEnv(mock, [])
  await assert.rejects(
    extract({ prompt: kyoto.prompt, schema: kyoto.schema }),
    (error: unknown) =>
      error instanceof MissingKeyError &&
      /OPENROUTER_API_KEY or OPENAI_API_KEY/.test(error.message),
  )
  assert.equal(mock.requests.length, 0)
})

test('the request asks for strict JSON with text.format, on OpenRouter first', async () => {
  undo = useMockEnv(mock)
  const result = await extract({
    prompt: kyoto.prompt,
    schema: kyoto.schema,
    name: 'city',
  })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openrouter')
  assert.equal(sent.body.model, 'openai/gpt-6-luna')
  assert.equal(sent.body.input, 'Return the city and country for Kyoto.')
  assert.deepEqual(sent.body.text.format, {
    type: 'json_schema',
    name: 'city',
    strict: true,
    schema: {
      type: 'object',
      properties: { city: { type: 'string' }, country: { type: 'string' } },
      required: ['city', 'country'],
      additionalProperties: false,
    },
  })
  assert.equal(sent.body.store, false)
  assert.equal(sent.body.reasoning.effort, 'low')
  assert.ok(sent.body.max_output_tokens <= 2000)

  assert.equal(
    result.outputText,
    '{"city":"Kyoto","country":"Japan"}',
    'the API returns a string',
  )
  assert.deepEqual(result.parsed, { city: 'Kyoto', country: 'Japan' })
  assert.equal(result.check?.ok, true)
  assert.equal(result.usage?.costSource, 'provider')
})

test('OpenAI gets the same text.format', async () => {
  undo = useMockEnv(mock)
  const result = await extract({
    prompt: kyoto.prompt,
    schema: kyoto.schema,
    name: 'city',
    provider: 'openai',
  })
  const sent = mock.requests[0]
  assert.equal(sent.provider, 'openai')
  assert.equal(sent.body.model, 'gpt-6-luna')
  assert.equal(sent.body.text.format.strict, true)
  assert.equal(result.usage?.costSource, 'estimate')
})

test('a schema controls the shape, not the truth: the invented city passes too', async () => {
  undo = useMockEnv(mock)
  const real = await extract({
    prompt: kyoto.prompt,
    schema: kyoto.schema,
    name: kyoto.name,
  })
  const fake = await extract({
    prompt: invented.prompt,
    schema: invented.schema,
    name: invented.name,
  })
  assert.deepEqual(invented.schema, kyoto.schema, 'the same schema for both')
  assert.equal(real.check?.ok, true)
  assert.equal(fake.check?.ok, true, 'the made-up answer has the right shape')
  assert.equal((fake.parsed as { city: string }).city, INVENTED_CITY)
  assert.equal(kyoto.real, true)
  assert.equal(
    invented.real,
    false,
    'only we know it is made up; the check does not',
  )
})

test('the check catches a wrong shape that a non-strict model could return', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.text(
      request,
      '{"city":"Kyoto","population":"about 1.5 million","mayor":"x"}',
    )
  const result = await extract({
    prompt: population.prompt,
    schema: population.schema,
    name: population.name,
  })
  assert.equal(result.check?.ok, false)
  assert.deepEqual(result.check?.errors, [
    '$: missing required "country"',
    '$.population: expected integer, got string',
    '$: "mayor" is not allowed (additionalProperties: false)',
  ])
})

test('the population preset parses an integer', async () => {
  undo = useMockEnv(mock)
  const result = await extract({
    prompt: population.prompt,
    schema: population.schema,
    name: population.name,
  })
  assert.equal(
    mock.requests[0].body.text.format.schema.properties.population.type,
    'integer',
  )
  assert.equal(result.check?.ok, true)
  assert.equal((result.parsed as { population: number }).population, 1460000)
})

test('text that is not JSON: a parse error and no check', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) => m.incomplete(request, '{"city":"Ky')
  const result = await extract({ prompt: kyoto.prompt, schema: kyoto.schema })
  assert.ok(result.parseError)
  assert.equal(result.check, null)
  assert.equal(result.incompleteReason, 'max_output_tokens')
})

test('a refusal is read from the message', async () => {
  undo = useMockEnv(mock)
  mock.respond = (request, m) =>
    m.response(request, [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
      },
    ])
  const result = await extract({ prompt: kyoto.prompt, schema: kyoto.schema })
  assert.equal(result.refusal, 'I cannot help with that.')
  assert.equal(result.parseError, 'The model returned no text.')
})

test('a schema that strict mode rejects comes back as a result with the API error', async () => {
  undo = useMockEnv(mock, ['openai'])
  mock.respond = (_request, m) =>
    m.error(
      400,
      "Invalid schema for response_format 'city': 'required' must include every key in properties. Missing 'country'.",
    )
  const schema = { ...kyoto.schema, required: ['city'] }
  const result = await extract({ prompt: kyoto.prompt, schema, name: 'city' })
  assert.match(result.rejected ?? '', /HTTP 400.*Missing 'country'/)
  assert.equal(result.check, null)
  assert.deepEqual((result.request as any).body.text.format.schema.required, [
    'city',
  ])
})

test('other HTTP errors throw and never show the key', async () => {
  undo = useMockEnv(mock, ['openai'])
  process.env.OPENAI_API_KEY = 'sk-bad-0123456789abcdef'
  await assert.rejects(
    extract({ prompt: kyoto.prompt, schema: kyoto.schema }),
    (error: Error) =>
      /HTTP 401/.test(error.message) &&
      !error.message.includes('sk-bad-0123456789abcdef'),
  )
})

test('api.run checks the schema before any request', async () => {
  undo = useMockEnv(mock)
  assert.throws(
    () => api.run({ prompt: 'x', schema: '{ not json' }),
    /not valid JSON/,
  )
  assert.throws(
    () => api.run({ prompt: 'x', schema: '{"type":"string"}' }),
    /"type": "object"/,
  )
  assert.throws(
    () =>
      api.run({
        prompt: 'x',
        schema: JSON.stringify(kyoto.schema),
        name: 'bad name!',
      }),
    /letters, digits/,
  )
  assert.throws(
    () =>
      api.run({
        prompt: 'x'.repeat(2001),
        schema: JSON.stringify(kyoto.schema),
      }),
    /under 2000/,
  )
  await assert.rejects(
    api.run({ prompt: '  ', schema: JSON.stringify(kyoto.schema) }),
    /Write a prompt/,
  )
  assert.equal(mock.requests.length, 0)
  assert.deepEqual(api.checkSchema({ schema: JSON.stringify(kyoto.schema) }), {
    ok: true,
    fields: ['city', 'country'],
  })
  assert.equal(api.checkSchema({ schema: 42 }).ok, false)
})

test('the checker: types, enum, arrays and keywords it does not check', () => {
  const schema = readSchema(
    JSON.stringify({
      type: 'object',
      properties: {
        n: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['S', 'M'] },
        note: { type: ['string', 'null'], pattern: '^a' },
      },
      required: ['n', 'tags', 'size', 'note'],
      additionalProperties: false,
    }),
  )
  assert.equal(
    check(schema, { n: 3, tags: ['a'], size: 'S', note: null }).ok,
    true,
    'an integer is also a number',
  )
  const bad = check(schema, { n: '3', tags: ['a', 2], size: 'XL', note: 'b' })
  assert.deepEqual(bad.errors, [
    '$.n: expected number, got string',
    '$.tags[1]: expected string, got integer',
    '$.size: "XL" is not one of ["S","M"]',
  ])
  assert.deepEqual(bad.skipped, ['$.note: pattern'])
  assert.throws(() => readSchema('[]'), /JSON object/)
  assert.throws(() => readSchema('{"type":"object"}'), /"properties"/)
})
