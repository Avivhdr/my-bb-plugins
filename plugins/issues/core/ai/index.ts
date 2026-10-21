// Refine, routed to whichever provider the user has configured.
//
// Both transports answer to the same prompt (prompt.ts) and return the same
// TicketDraft, so this layer only picks one and normalizes its failures.

import { describeAnthropicError, refineWithAnthropic, reviseWithAnthropic } from './anthropic'
import { refineWithGroq, reviseWithGroq } from './groq'
import { keyFor, resolveProvider } from '../aiSettings'
import type { AiProvider, AiSettings } from '../aiSettings'
import type { RepoContext, ReviseInput, TicketDraft } from './prompt'

export type { RepoContext, ReviseInput, TicketDraft } from './prompt'

export class MissingApiKeyError extends Error {
  constructor() {
    super('Add an Anthropic or Groq API key in Settings → Plugins → Issues to enable AI ticket drafting.')
    this.name = 'MissingApiKeyError'
  }
}

/** Map a failure to something a user can act on, in the vocabulary of the provider used. */
export function describeAiError(error: unknown, provider: AiProvider | null): string {
  if (error instanceof MissingApiKeyError) return error.message
  // The Groq transport has already turned its HTTP failures into user-facing text
  // (describeGroqError names the limit and when it clears), so its message passes
  // through. Only the Anthropic SDK hands back a raw error whose status still has to
  // be read to know whether the user should wait or fix their key.
  if (provider === 'groq') {
    const message = error instanceof Error ? error.message : String(error)
    return message || 'The AI request failed.'
  }
  return describeAnthropicError(error)
}

function selected(settings: AiSettings): { provider: AiProvider; key: string } {
  const provider = resolveProvider(settings)
  if (!provider) throw new MissingApiKeyError()
  return { provider, key: keyFor(settings, provider) }
}

// Both are `async` so a missing key arrives as a rejection like every other failure,
// rather than as a synchronous throw callers would have to guard separately.
export async function refineTicket(
  settings: AiSettings,
  text: string,
  context?: RepoContext,
): Promise<TicketDraft> {
  const { provider, key } = selected(settings)
  return provider === 'groq' ? refineWithGroq(key, text, context) : refineWithAnthropic(key, text, context)
}

export async function reviseTicket(settings: AiSettings, input: ReviseInput): Promise<TicketDraft> {
  const { provider, key } = selected(settings)
  return provider === 'groq' ? reviseWithGroq(key, input) : reviseWithAnthropic(key, input)
}
