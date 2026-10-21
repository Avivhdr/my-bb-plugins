// The Anthropic transport for ticket drafting. The prompt itself lives in prompt.ts,
// shared with the Groq transport.
//
// The reference implementation (github-roadmap) deliberately avoids JSON mode and
// splits a delimited plain-text reply, because Groq's json_object mode is
// prompt-guided rather than grammar-constrained, so a rich Markdown body escapes the
// envelope. Structured outputs here ARE grammar-constrained, so the envelope cannot be
// corrupted by the body and no delimited format or lenient parser is needed. See
// groq.ts, which keeps the reference's approach for the provider that requires it.

import Anthropic from '@anthropic-ai/sdk'
import { AI_BUDGET_MS } from './budget'
import { buildDraftMessage, buildDraftPrompt, buildReviseDraftPrompt, buildReviseMessage } from './prompt'
import type { RepoContext, ReviseInput, TicketDraft } from './prompt'

const MODEL = 'claude-haiku-4-5'
// Matches the reference implementation's ceiling: enough for a structured body,
// short enough that a runaway generation can't stall the dialog.
const MAX_TOKENS = 1800
// The whole budget goes to one attempt. There is no second model to fall back to
// here (unlike Groq), so an SDK retry would only be backoff on a rate limit — and a
// rate limit that needs backoff has already blown the latency budget this exists to
// protect. Spending the budget on a single generous attempt beats splitting it into
// two that each risk timing out a call that would have succeeded.
const TIMEOUT_MS = AI_BUDGET_MS
const MAX_RETRIES = 0

/** Constrains the reply so a Markdown body can never corrupt the envelope. */
export const TICKET_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'The issue title, following the title rules in the system prompt.',
    },
    body: {
      type: 'string',
      description: 'The GitHub-flavored Markdown body, following the section rules in the system prompt.',
    },
  },
  required: ['title', 'body'],
} as const

/** Map a failure to something a user can act on. */
export function describeAnthropicError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status
  if (status === 401 || status === 403) {
    return 'Anthropic rejected the API key — check the key in Settings → Plugins → Issues.'
  }
  if (status === 429) {
    return 'Anthropic rate limit reached — wait a few seconds and try Refine again.'
  }
  if (status === 529 || (typeof status === 'number' && status >= 500)) {
    return 'Anthropic is temporarily unavailable — try Refine again in a moment.'
  }

  const message = error instanceof Error ? error.message : String(error)
  return message || 'The AI request failed.'
}

function clientFor(key: string): Anthropic {
  return new Anthropic({ apiKey: key, maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS })
}

// Structured outputs guarantee the reply validates against TICKET_DRAFT_SCHEMA, so the
// only failures worth handling here are a truncated generation and an empty reply —
// neither of which the schema can prevent.
async function callAnthropic(key: string, system: string, user: string): Promise<TicketDraft> {
  const response = await clientFor(key).messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    output_config: { format: { type: 'json_schema', schema: TICKET_DRAFT_SCHEMA } },
    messages: [{ role: 'user', content: user }],
  })

  if (response.stop_reason === 'max_tokens') {
    throw new Error('The AI response was cut off before it finished. Try a shorter note.')
  }

  const text = response.content.find((block) => block.type === 'text')?.text ?? ''
  if (!text.trim()) throw new Error('The AI returned an empty response.')

  const draft = JSON.parse(text) as TicketDraft
  if (!draft.title?.trim()) throw new Error('The AI did not return a usable title.')
  if (!draft.body?.trim()) throw new Error('The AI did not return a usable body.')
  return { title: draft.title.trim(), body: draft.body.trim() }
}

export function refineWithAnthropic(
  key: string,
  text: string,
  context?: RepoContext,
): Promise<TicketDraft> {
  return callAnthropic(key, buildDraftPrompt(context), buildDraftMessage(text))
}

export function reviseWithAnthropic(key: string, input: ReviseInput): Promise<TicketDraft> {
  return callAnthropic(key, buildReviseDraftPrompt(input.context), buildReviseMessage(input))
}
