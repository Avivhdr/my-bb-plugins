import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeAiError, MissingApiKeyError, refineTicket, reviseTicket } from './index'
import type { AiSettings } from '../aiSettings'

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
  anthropicKey: '',
  groqKey: '',
  preferred: 'anthropic',
  ...over,
})

const DRAFT = { title: 'Add a filter', body: '## Problem\nIt is slow.' }

function stubGroq() {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: `TITLE: ${DRAFT.title}\nBODY:\n${DRAFT.body}` } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.unstubAllGlobals())

describe('provider routing', () => {
  it('routes to Groq when that is the resolved provider', async () => {
    const spy = stubGroq()

    expect(await refineTicket(settings({ groqKey: 'gsk_1' }), 'add a filter')).toEqual(DRAFT)
    expect(spy.mock.calls[0][0]).toContain('api.groq.com')
  })

  it('routes a revision to Groq too', async () => {
    const spy = stubGroq()

    const draft = await reviseTicket(settings({ groqKey: 'gsk_1', preferred: 'groq' }), {
      draft: DRAFT,
      feedback: 'shorter',
    })

    expect(draft).toEqual(DRAFT)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // With both keys present the preference decides, so a Groq preference must not reach
  // the Anthropic SDK (which would try a real network call with the wrong key).
  it('honours a Groq preference when both keys are present', async () => {
    const spy = stubGroq()

    await refineTicket(settings({ anthropicKey: 'sk-ant-1', groqKey: 'gsk_1', preferred: 'groq' }), 'x')

    expect(spy.mock.calls[0][0]).toContain('api.groq.com')
  })

  it('refuses to call anything when neither provider has a key', async () => {
    const spy = stubGroq()

    await expect(refineTicket(settings(), 'add a filter')).rejects.toBeInstanceOf(MissingApiKeyError)
    await expect(reviseTicket(settings(), { draft: DRAFT, feedback: 'x' })).rejects.toBeInstanceOf(
      MissingApiKeyError,
    )
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('describeAiError', () => {
  it('names both providers in the missing-key message, since either will do', () => {
    const message = describeAiError(new MissingApiKeyError(), null)
    expect(message).toContain('Anthropic')
    expect(message).toContain('Groq')
  })

  // The Groq transport already produced user-facing text; re-interpreting it would
  // discard the retry time it worked out.
  it('passes a Groq failure through untouched', () => {
    const message = describeAiError(new Error('Groq rate limit reached — try again in 4m58s.'), 'groq')
    expect(message).toBe('Groq rate limit reached — try again in 4m58s.')
  })

  it('interprets an Anthropic SDK status into an action', () => {
    const message = describeAiError(Object.assign(new Error('nope'), { status: 401 }), 'anthropic')
    expect(message).toContain('API key')
  })
})
