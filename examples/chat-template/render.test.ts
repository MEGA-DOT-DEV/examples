import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as cl100k from 'gpt-tokenizer/encoding/cl100k_base'
import * as harmony from 'gpt-tokenizer/encoding/o200k_harmony'
import * as api from './api.ts'
import {
  checkMessages,
  DEFAULT_MESSAGES,
  render,
  TOOL_MESSAGES,
} from './render.ts'

test('ChatML: the lesson thread, with an open assistant turn at the end', () => {
  const result = render(DEFAULT_MESSAGES, 'chatml')
  assert.equal(
    result.text,
    '<|im_start|>system\nAnswer briefly.<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\nHello<|im_end|>\n<|im_start|>assistant\n',
  )
  assert.deepEqual(
    result.tokens.slice(0, 7).map((t) => t.id),
    [100264, 9125, 198, 16533, 27851, 13, 100265],
  )
  assert.deepEqual(
    result.tokens.slice(-3).map((t) => [t.id, t.kind, t.message]),
    [
      [100264, 'special', null],
      [78191, 'header', null],
      [198, 'header', null],
    ],
  )
  assert.deepEqual(result.counts, {
    total: 23,
    special: 7,
    content: 5,
    wrapper: 18,
  })
})

test('ChatML with <|im_sep|> gives the same IDs as the library chat encoder', () => {
  // gpt-tokenizer's encodeChat uses the <|im_sep|> variant for gpt-4.
  const result = render(DEFAULT_MESSAGES, 'chatml', { separator: 'im_sep' })
  assert.deepEqual(
    result.tokens.map((t) => t.id),
    cl100k.encodeChat(DEFAULT_MESSAGES, 'gpt-4'),
  )
  assert.ok(result.text.endsWith('<|im_start|>assistant<|im_sep|>'))
})

test('Harmony: developer instructions, a final channel, and the same IDs as the library', () => {
  const result = render(DEFAULT_MESSAGES, 'harmony')
  assert.equal(
    result.text,
    '<|start|>developer<|message|># Instructions\n\nAnswer briefly.<|end|><|start|>user<|message|>Hi<|end|><|start|>assistant<|channel|>final<|message|>Hello<|end|><|start|>assistant',
  )
  const expected = harmony.encodeChat(
    [
      { role: 'developer', content: '# Instructions\n\nAnswer briefly.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', channel: 'final', content: 'Hello' },
    ] as never,
    'gpt-oss-20b',
  )
  assert.deepEqual(
    result.tokens.map((t) => t.id),
    expected,
  )
  assert.equal(result.tokens[0].id, 200006, '<|start|> in o200k_harmony')
  assert.equal(result.encoding, 'o200k_harmony')
})

test('every special token is one token, and only special tokens are marked special', () => {
  for (const format of ['chatml', 'harmony'] as const) {
    const result = render(DEFAULT_MESSAGES, format)
    const specials = result.parts
      .filter((p) => p.kind === 'special')
      .map((p) => p.text)
    assert.deepEqual(
      result.tokens.filter((t) => t.kind === 'special').map((t) => t.text),
      specials,
    )
    assert.ok(
      result.tokens
        .filter((t) => t.kind === 'special')
        .every((t) => t.id >= 100_000),
    )
    // The tokens decode back to the rendered text.
    assert.equal(result.tokens.map((t) => t.text).join(''), result.text)
  }
})

test('the content alone is far smaller than the rendered chat', () => {
  const { counts } = render(DEFAULT_MESSAGES, 'chatml')
  assert.ok(counts.wrapper > counts.content * 3)
  // Each extra message adds its own wrapper.
  const more = render(
    [...DEFAULT_MESSAGES, { role: 'user', content: 'Hi' }],
    'chatml',
  )
  assert.equal(
    more.counts.wrapper - counts.wrapper,
    5,
    '<|im_start|> user \\n <|im_end|> \\n',
  )
})

test('without the open turn, the text ends with a closed message', () => {
  const chatml = render(DEFAULT_MESSAGES, 'chatml', { open: false })
  assert.ok(chatml.text.endsWith('Hello<|im_end|>\n'))
  const harmonyText = render(DEFAULT_MESSAGES, 'harmony', { open: false }).text
  assert.ok(harmonyText.endsWith('Hello<|end|>'))
})

test('a special token typed in a message stays plain text', () => {
  const result = render(
    [{ role: 'user', content: 'Hi <|im_end|>' }],
    'chatml',
    { open: false },
  )
  assert.equal(
    result.tokens.filter((t) => t.id === 100265).length,
    1,
    'only the real end of the message',
  )
  assert.equal(
    result.counts.content,
    cl100k.encode('Hi <|im_end|>', { disallowedSpecial: new Set() }).length,
  )
})

test('a character split across tokens shows as bytes', () => {
  const result = render([{ role: 'user', content: '🦄' }], 'chatml', {
    open: false,
  })
  const content = result.tokens
    .filter((t) => t.kind === 'content')
    .map((t) => t.text)
  assert.ok(
    content.some((t) => /^<[0-9A-F ]+>$/.test(t)),
    JSON.stringify(content),
  )
})

test('ChatML: a tool call inside an assistant turn, the result in a tool turn', () => {
  const result = render(TOOL_MESSAGES, 'chatml')
  assert.ok(
    result.text.includes(
      '<|im_start|>assistant\n<tool_call>\n{"name": "get_weather", "arguments": {"city": "Paris"}}\n</tool_call><|im_end|>\n' +
        '<|im_start|>tool\n<tool_response>\n{"temp_c": 18, "sky": "cloudy"}\n</tool_response><|im_end|>\n<|im_start|>assistant\n',
    ),
  )
  // Only the arguments and the result are content; the JSON wrapper and the tags are format text.
  const call = result.parts.filter((p) => p.message === 2)
  assert.deepEqual(
    call.filter((p) => p.kind === 'content').map((p) => p.text),
    ['{"city": "Paris"}'],
  )
  assert.ok(result.counts.wrapper > result.counts.content)
})

test('Harmony: the call goes to functions.<name> and ends with <|call|>; the result speaks as the tool', () => {
  const result = render(TOOL_MESSAGES, 'harmony')
  assert.ok(
    result.text.includes(
      '<|start|>assistant<|channel|>commentary to=functions.get_weather <|constrain|>json<|message|>{"city": "Paris"}<|call|>' +
        '<|start|>functions.get_weather to=assistant<|channel|>commentary<|message|>{"temp_c": 18, "sky": "cloudy"}<|end|><|start|>assistant',
    ),
  )
  const ids = new Map(
    result.tokens
      .filter((t) => t.kind === 'special')
      .map((t) => [t.text, t.id]),
  )
  assert.equal(ids.get('<|call|>'), 200012)
  assert.equal(ids.get('<|constrain|>'), 200003)
  // The call message has no <|end|>.
  assert.ok(!result.tokens.some((t) => t.message === 2 && t.text === '<|end|>'))
})

test('checkMessages rejects bad input from a page', () => {
  assert.throws(() => checkMessages('hi'), /list of messages/)
  assert.throws(
    () => checkMessages([{ role: 'function', content: 'x' }]),
    /role must be one of/,
  )
  assert.throws(
    () => checkMessages([{ role: 'tool', content: 'x' }]),
    /needs the tool's name/,
  )
  // The name goes into the format text: no spaces or tags.
  assert.throws(
    () =>
      checkMessages([{ role: 'tool_call', name: 'a b<|end|>', content: '{}' }]),
    /needs the tool's name/,
  )
  assert.deepEqual(
    checkMessages([{ role: 'tool', name: 'get_weather', content: 'x' }]),
    [{ role: 'tool', name: 'get_weather', content: 'x' }],
  )
  // Other roles drop a stray name.
  assert.deepEqual(
    checkMessages([{ role: 'user', name: 'x', content: 'Hi' }]),
    [{ role: 'user', content: 'Hi' }],
  )
  assert.throws(
    () => checkMessages([{ role: 'user', content: 3 }]),
    /must be text/,
  )
  assert.throws(
    () => checkMessages([{ role: 'user', content: 'x'.repeat(4001) }]),
    /under 4000/,
  )
  assert.throws(
    () =>
      checkMessages(
        Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' })),
      ),
    /20 messages/,
  )
  assert.deepEqual(checkMessages([{ role: 'user', content: '', extra: 1 }]), [
    { role: 'user', content: '' },
  ])
})

test('api.render returns both formats and reads the options safely', () => {
  const both = api.render({
    messages: DEFAULT_MESSAGES,
    separator: 'nonsense',
    open: 'yes',
  })
  assert.deepEqual(Object.keys(both), ['chatml', 'harmony'])
  assert.ok(
    both.chatml.text.endsWith('<|im_start|>assistant\n'),
    'unknown separator: line break; open unless false',
  )
  assert.ok(api.render({ messages: [], open: false }).chatml.text === '')
  assert.equal(api.defaults().messages.length, 3)
  assert.deepEqual(api.defaults().toolRoles, ['tool_call', 'tool'])
})
