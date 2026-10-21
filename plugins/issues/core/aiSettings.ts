// The API keys powering Refine, and which provider to spend them on.
//
// The keys are secret plugin settings: bb keeps them in a 0600 file on the server and
// never sends them to the browser. The frontend learns only whether Refine can run, so
// the empty/absent rules live here and the dialog's gate matches what the backend will
// actually find when it goes to call an API.

export type AiProvider = 'anthropic' | 'groq'

export interface AiSettings {
  anthropicKey: string
  groqKey: string
  /** Which provider to prefer when both keys are present. */
  preferred: AiProvider
}

/** The provider used when the user has never expressed a preference. */
export const DEFAULT_PROVIDER: AiProvider = 'anthropic'

function isProvider(value: unknown): value is AiProvider {
  return value === 'anthropic' || value === 'groq'
}

/**
 * A stored key, or '' when there is none. Whitespace-only is treated as absent so a key
 * the user blanked out can't leave Refine enabled but failing at call time.
 */
function readKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Normalize raw setting values into the settings Refine runs on. */
export function aiSettingsFrom(values: {
  anthropicApiKey?: unknown
  groqApiKey?: unknown
  aiProvider?: unknown
}): AiSettings {
  return {
    anthropicKey: readKey(values.anthropicApiKey),
    groqKey: readKey(values.groqApiKey),
    preferred: isProvider(values.aiProvider) ? values.aiProvider : DEFAULT_PROVIDER,
  }
}

/** The key for a given provider, or '' when that provider has none. */
export function keyFor(settings: AiSettings, provider: AiProvider): string {
  return provider === 'anthropic' ? settings.anthropicKey : settings.groqKey
}

/**
 * Which provider a Refine will actually use, or `null` when neither has a key.
 *
 * The preference decides only when it can be honoured. A user who prefers one provider
 * but has only pasted the other's key gets a working Refine rather than an error telling
 * them to go and change a setting they never knowingly chose.
 */
export function resolveProvider(settings: AiSettings): AiProvider | null {
  if (keyFor(settings, settings.preferred)) return settings.preferred
  const other: AiProvider = settings.preferred === 'anthropic' ? 'groq' : 'anthropic'
  if (keyFor(settings, other)) return other
  return null
}

/** Whether Refine has any usable provider — what the dialog gates on. */
export function hasUsableProvider(settings: AiSettings): boolean {
  return resolveProvider(settings) !== null
}
