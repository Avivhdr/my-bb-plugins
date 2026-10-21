import { describe, it, expect } from 'vitest'
import { describeAnthropicError, TICKET_DRAFT_SCHEMA } from './anthropic'

describe('TICKET_DRAFT_SCHEMA', () => {
  it('constrains the reply to exactly a title and a body', () => {
    expect(TICKET_DRAFT_SCHEMA.required).toEqual(['title', 'body'])
    expect(TICKET_DRAFT_SCHEMA.additionalProperties).toBe(false)
    expect(Object.keys(TICKET_DRAFT_SCHEMA.properties)).toEqual(['title', 'body'])
  })
})

describe('describeAnthropicError', () => {
  it('names the rate limit so the user knows to wait rather than retry blindly', () => {
    const msg = describeAnthropicError(Object.assign(new Error('429 too many'), { status: 429 }))
    expect(msg).toContain('rate limit')
  })

  it('calls out an invalid key rather than surfacing a bare 401', () => {
    const msg = describeAnthropicError(Object.assign(new Error('bad key'), { status: 401 }))
    expect(msg).toContain('API key')
  })

  it('reports an overloaded upstream as temporary', () => {
    const msg = describeAnthropicError(Object.assign(new Error('overloaded'), { status: 529 }))
    expect(msg).toContain('temporarily')
  })

  it('surfaces the underlying message for other failures', () => {
    expect(describeAnthropicError(new Error('socket hang up'))).toContain('socket hang up')
  })
})
