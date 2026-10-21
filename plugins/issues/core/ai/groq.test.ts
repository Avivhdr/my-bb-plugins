import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeGroqError, FORMAT_GUIDE, parseDraft, refineWithGroq } from './groq'

afterEach(() => vi.unstubAllGlobals())

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch(...responses: Response[]) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra Groq call')
    return next
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

const RATE_LIMITED = {
  error: { message: 'Rate limit reached for model. Please try again in 4m58.08s. Need more tokens? Upgrade now.' },
}

describe('parseDraft', () => {
  it('splits the delimited reply into a title and a body', () => {
    expect(parseDraft('TITLE: Add a filter\nBODY:\n## Problem\nIt is slow.')).toEqual({
      title: 'Add a filter',
      body: '## Problem\nIt is slow.',
    })
  })

  it('tolerates bolded markers and a wrapping code fence', () => {
    const raw = '```\n**TITLE:** Add a filter\n**BODY:**\n## Problem\nIt is slow.\n```'
    expect(parseDraft(raw)).toEqual({ title: 'Add a filter', body: '## Problem\nIt is slow.' })
  })

  // The body is Markdown, so it can legitimately contain the word BODY: — the split has
  // to take the FIRST body marker and keep the rest verbatim.
  it('keeps body text that mentions the markers itself', () => {
    const draft = parseDraft('TITLE: Doc the format\nBODY:\nWrite BODY: on its own line.')
    expect(draft.body).toBe('Write BODY: on its own line.')
  })

  it('recovers a bare leading title when only the body marker survives', () => {
    expect(parseDraft('Add a filter\nBODY:\n## Problem\nIt is slow.')).toEqual({
      title: 'Add a filter',
      body: '## Problem\nIt is slow.',
    })
  })

  it('strips heading marks and wrapping quotes from the title', () => {
    expect(parseDraft('TITLE: "Add a filter"\nBODY:\nx').title).toBe('Add a filter')
    expect(parseDraft('# Add a filter\nBODY:\nx').title).toBe('Add a filter')
  })

  it('takes the remainder as the body when the model skips the body marker', () => {
    expect(parseDraft('TITLE: Add a filter\n## Problem\nIt is slow.').body).toBe('## Problem\nIt is slow.')
  })

  it('rejects a reply carrying no usable title or body', () => {
    expect(() => parseDraft('just some prose')).toThrow(/usable title/)
    expect(() => parseDraft('TITLE: Add a filter\nBODY:\n')).toThrow(/usable body/)
  })
})

describe('describeGroqError', () => {
  it('quotes the retry delay without the fractional seconds', () => {
    const msg = describeGroqError(429, JSON.stringify(RATE_LIMITED))
    expect(msg).toContain('4m58s')
    expect(msg).not.toContain('4m58.08s')
  })

  it('drops the upgrade pitch, which is noise in an error line', () => {
    expect(describeGroqError(429, JSON.stringify(RATE_LIMITED))).not.toContain('Upgrade now')
  })

  // A daily limit can be half an hour out, so the message must not imply seconds.
  it('names a daily limit as such', () => {
    const body = { error: { message: 'Rate limit reached: 100000 tokens per day (TPD). Please try again in 22m10s.' } }
    expect(describeGroqError(429, JSON.stringify(body))).toContain('daily token limit')
  })

  it('calls out an invalid key rather than surfacing a bare 401', () => {
    expect(describeGroqError(401, '{}')).toContain('API key')
  })

  it('surfaces the message, code and failed generation for other failures', () => {
    const body = { error: { message: 'bad request', code: 'json_validate_failed', failed_generation: '## Problem' } }
    const msg = describeGroqError(400, JSON.stringify(body))
    expect(msg).toContain('bad request')
    expect(msg).toContain('json_validate_failed')
    expect(msg).toContain('## Problem')
  })

  it('falls back to a raw excerpt when the body is not a Groq envelope', () => {
    expect(describeGroqError(502, '<html>gateway</html>')).toContain('gateway')
  })
})

describe('refineWithGroq', () => {
  it('asks for the delimited envelope, since Groq JSON mode cannot be trusted with Markdown', async () => {
    const spy = stubFetch(completion('TITLE: Add a filter\nBODY:\n## Problem\nIt is slow.'))

    await refineWithGroq('gsk_test', 'add a filter')

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.messages[0].content).toContain(FORMAT_GUIDE)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test')
  })

  // The budget is per model, so a capped primary is a routing decision, not a dead end.
  it('retries a rate-limited primary on the backup model', async () => {
    const spy = stubFetch(
      errorResponse(429, RATE_LIMITED),
      completion('TITLE: Add a filter\nBODY:\n## Problem\nIt is slow.'),
    )

    const draft = await refineWithGroq('gsk_test', 'add a filter')

    expect(draft.title).toBe('Add a filter')
    expect(JSON.parse((spy.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).model).toBe(
      'openai/gpt-oss-20b',
    )
  })

  // Anything but a rate limit would fail identically on the backup, so retrying it
  // would burn a second call to learn nothing.
  it('does not fall back for a failure a different model cannot fix', async () => {
    const spy = stubFetch(errorResponse(400, { error: { message: 'bad request' } }))

    await expect(refineWithGroq('gsk_test', 'add a filter')).rejects.toThrow(/bad request/)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('gives up when the backup is capped too, surfacing its retry time', async () => {
    stubFetch(errorResponse(429, RATE_LIMITED), errorResponse(429, RATE_LIMITED))

    await expect(refineWithGroq('gsk_test', 'add a filter')).rejects.toThrow(/4m58s/)
  })

  it('reports an empty completion rather than returning a blank draft', async () => {
    stubFetch(completion(''))

    await expect(refineWithGroq('gsk_test', 'add a filter')).rejects.toThrow(/empty response/)
  })
})
