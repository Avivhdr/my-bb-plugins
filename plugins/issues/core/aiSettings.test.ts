import { describe, expect, it } from 'vitest'
import { aiSettingsFrom, hasUsableProvider, keyFor, resolveProvider } from './aiSettings'
import type { AiSettings } from './aiSettings'

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
  anthropicKey: '',
  groqKey: '',
  preferred: 'anthropic',
  ...over,
})

describe('aiSettingsFrom', () => {
  it('reads both keys and the preference', () => {
    expect(aiSettingsFrom({ anthropicApiKey: 'sk-ant-1', groqApiKey: 'gsk_1', aiProvider: 'groq' })).toEqual({
      anthropicKey: 'sk-ant-1',
      groqKey: 'gsk_1',
      preferred: 'groq',
    })
  })

  it('reports unset keys as empty and defaults the preference', () => {
    expect(aiSettingsFrom({})).toEqual(settings())
  })

  it('trims a pasted key and treats a whitespace-only one as absent', () => {
    expect(aiSettingsFrom({ anthropicApiKey: '  sk-ant-1\n', groqApiKey: '   ' })).toEqual(
      settings({ anthropicKey: 'sk-ant-1' }),
    )
  })

  it('falls back to the default for a stored value that is not a provider', () => {
    expect(aiSettingsFrom({ aiProvider: 'openai' }).preferred).toBe('anthropic')
  })
})

describe('resolveProvider', () => {
  it('honours the preference when that provider has a key', () => {
    expect(resolveProvider(settings({ anthropicKey: 'a', groqKey: 'g', preferred: 'groq' }))).toBe('groq')
    expect(resolveProvider(settings({ anthropicKey: 'a', groqKey: 'g', preferred: 'anthropic' }))).toBe('anthropic')
  })

  // The whole point of accepting two providers: having only the other one's key should
  // still give a working Refine, not an error about a setting the user never chose.
  it('uses the other provider when the preferred one has no key', () => {
    expect(resolveProvider(settings({ groqKey: 'g', preferred: 'anthropic' }))).toBe('groq')
    expect(resolveProvider(settings({ anthropicKey: 'a', preferred: 'groq' }))).toBe('anthropic')
  })

  it('resolves to nothing when neither provider has a key', () => {
    expect(resolveProvider(settings())).toBeNull()
    expect(hasUsableProvider(settings())).toBe(false)
  })

  it('reports a usable provider whenever either key is present', () => {
    expect(hasUsableProvider(settings({ groqKey: 'g' }))).toBe(true)
    expect(hasUsableProvider(settings({ anthropicKey: 'a' }))).toBe(true)
  })
})

describe('keyFor', () => {
  it('returns the key belonging to the named provider', () => {
    const both = settings({ anthropicKey: 'a', groqKey: 'g' })

    expect(keyFor(both, 'anthropic')).toBe('a')
    expect(keyFor(both, 'groq')).toBe('g')
  })
})
