import { describe, expect, it } from 'vitest'
import {
  collapseToBilledResponses,
  isBillable,
  LineAssembler,
  parseBilledResponse,
} from './transcript'

function record(overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  const { message, ...rest } = overrides
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-27T09:15:00.000Z',
    cwd: '/Users/dev/project',
    ...rest,
    message: {
      id: 'msg_1',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2,
        output_tokens: 100,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 900,
        cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 100 },
        ...usage,
      },
      ...(message as object | undefined),
    },
  })
}

describe('parseBilledResponse', () => {
  it('reads the cache-write split, which alone distinguishes the two write rates', () => {
    expect(parseBilledResponse(record())?.tokens).toEqual({
      input: 2,
      output: 100,
      cacheWrite5m: 400,
      cacheWrite1h: 100,
      cacheRead: 900,
    })
  })

  it('treats a transcript without the split as entirely five-minute writes', () => {
    const line = record({}, { cache_creation: undefined })

    expect(parseBilledResponse(line)?.tokens).toMatchObject({ cacheWrite5m: 500, cacheWrite1h: 0 })
  })

  it('ignores records that carry no usage', () => {
    expect(parseBilledResponse(JSON.stringify({ type: 'cost-state', totalCostUSD: 3 }))).toBeNull()
    expect(parseBilledResponse('')).toBeNull()
    expect(parseBilledResponse('{ not json')).toBeNull()
  })

  it('ignores a usage record with no timestamp to place it in time', () => {
    expect(parseBilledResponse(record({ timestamp: undefined }))).toBeNull()
  })
})

describe('collapseToBilledResponses', () => {
  it('keeps the last record for a message id, because earlier ones hold partial output', () => {
    const partial = parseBilledResponse(record({}, { output_tokens: 6 }))!
    const complete = parseBilledResponse(record({}, { output_tokens: 206 }))!

    const collapsed = collapseToBilledResponses([partial, complete])

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.tokens.output).toBe(206)
  })

  it('keeps distinct message ids apart', () => {
    const first = parseBilledResponse(record({ message: { id: 'msg_1' } }))!
    const second = parseBilledResponse(record({ message: { id: 'msg_2' } }))!

    expect(collapseToBilledResponses([first, second])).toHaveLength(2)
  })
})

describe('isBillable', () => {
  it('rejects a response whose every token count is zero', () => {
    const line = record({ message: { id: 'msg_z', model: '<synthetic>' } }, {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    })

    expect(isBillable(parseBilledResponse(line)!)).toBe(false)
  })
})

describe('LineAssembler', () => {
  it('holds back the text after the last newline until the next chunk', () => {
    const assembler = new LineAssembler()

    expect(assembler.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(assembler.push(':2}\n')).toEqual(['{"b":2}'])
    expect(assembler.flush()).toEqual([])
  })

  it('yields a trailing line that never got a newline', () => {
    const assembler = new LineAssembler()
    assembler.push('{"a":1}')

    expect(assembler.flush()).toEqual(['{"a":1}'])
  })
})
