// The Groq transport for ticket drafting. The prompt itself lives in prompt.ts,
// shared with the Anthropic transport.
//
// Ported from the github-roadmap reference implementation (src/lib/groq/client.ts).
// Everything provider-specific about that file is here: the delimited plain-text
// envelope and its lenient parser, the hand-parsed error envelope, and the
// primary/backup model pair. The one difference is the key source: it comes from the
// plugin's secret settings rather than a server env var.

import { AI_BUDGET_MS } from './budget'
import { buildDraftMessage, buildDraftPrompt, buildReviseDraftPrompt, buildReviseMessage } from './prompt'
import type { RepoContext, ReviseInput, TicketDraft } from './prompt'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Groq deprecated llama-3.3-70b-versatile (and llama-3.1-8b-instant) for free/developer-tier
// keys on 2026-08-16; a request now gets a 404 model_not_found instead of a completion.
// openai/gpt-oss-120b and openai/gpt-oss-20b are Groq's own recommended replacements, and
// unlike qwen/qwen3.6-27b (Groq's other suggestion) both are production models rather than
// preview, so they aren't liable to be pulled again on short notice the same way.
const GROQ_MODEL = 'openai/gpt-oss-120b'
// Rate limits are per model, so a capped primary is a routing decision rather than a
// dead end: this backup carries its own separate daily budget. A refine costs ~2.9k
// tokens against a 200k/day allowance, so the primary can genuinely run out for the day.
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b'
const MAX_TOKENS = 1800
const TEMPERATURE = 0.4
// Two attempts have to fit the budget between them, since the backup model is only
// reached after the primary has already spent its share. Giving each the full budget
// would put the fallback past the host's deadline, where its result can never arrive —
// which would make the fallback pure cost.
const ATTEMPTS = 2
const TIMEOUT_MS = Math.floor(AI_BUDGET_MS / ATTEMPTS)

/**
 * A rate limit is the one Groq failure a different model can fix, so it has to be
 * distinguishable from failures that would fail identically anywhere (a 400, a bad parse).
 */
export class GroqRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroqRateLimitError'
  }
}

// Both prompts ask for one plain-text reply carrying both fields, split by markers.
//
// This deliberately avoids Groq's json_object mode. That mode is prompt-guided rather
// than grammar-constrained on this model: the model is merely *asked* for JSON and the
// server validates the result afterwards. A rich Markdown body reliably pushes it off
// the rails — it stops quoting the string and emits bare Markdown after `"body":`, which
// the server rejects with a 400 (json_validate_failed). Plain text has no escaping to get
// wrong, so the body cannot corrupt the envelope, and a drifting reply degrades to a
// lenient local parse instead of a failed request.
export const FORMAT_GUIDE = `Reply in EXACTLY this format and nothing else — no JSON, no code fences, no commentary:

TITLE: <the issue title>
BODY:
<the GitHub-flavored Markdown body>`

// Markers may arrive bolded ("**TITLE:**") or lightly decorated, so tolerate that much.
// The title marker is matched once, and the body is everything past the first body
// marker after it — so Markdown in the body can mention either marker harmlessly.
const TITLE_MARKER = /^[ \t>#*]*TITLE:[ \t*]*(.+?)[ \t*]*$/im
const BODY_MARKER = /^[ \t>#*]*BODY:[ \t*]*/im

/**
 * Split the model's delimited reply into a draft. Kept pure (no network) so the
 * parsing and validation can be unit-tested directly.
 */
export function parseDraft(raw: string): TicketDraft {
  let text = raw.trim()
  // Tolerate a model that wraps the reply in a fence despite instructions.
  if (text.startsWith('```')) {
    text = text
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  }

  // Drop decoration the model sometimes adds: a leading heading mark, wrapping quotes.
  const cleanTitle = (s: string) =>
    s
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/^"(.*)"$/s, '$1')
      .trim()

  const titleMatch = text.match(TITLE_MARKER)
  let title: string
  let rest: string
  if (titleMatch) {
    title = cleanTitle(titleMatch[1])
    rest = text.slice(titleMatch.index! + titleMatch[0].length)
  } else {
    // Some models lead with a bare title and keep only the BODY: marker. Recover rather
    // than fail the draft: the last line before BODY: is the title.
    const lead = text.match(BODY_MARKER)
    if (!lead) throw new Error('The AI did not return a usable title.')
    const before = text
      .slice(0, lead.index!)
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    title = cleanTitle(before[before.length - 1] ?? '')
    rest = text.slice(lead.index!) // keep the marker so the shared split below finds it
  }

  // Everything after the title is body material. If the model skipped the BODY: marker,
  // take that remainder as-is rather than failing the whole draft.
  const bodyMatch = rest.match(BODY_MARKER)
  const body = (bodyMatch ? rest.slice(bodyMatch.index! + bodyMatch[0].length) : rest).trim()

  if (!title) throw new Error('The AI did not return a usable title.')
  if (!body) throw new Error('The AI did not return a usable body.')
  return { title, body }
}

/**
 * Groq reports failures as `{"error":{message,type,code,failed_generation}}`, and every
 * field earns its place: `message` names which limit was hit and when it clears, and
 * `failed_generation` carries the model output that failed validation. Blind-slicing the
 * raw JSON throws exactly that away, so parse the envelope and surface the useful parts.
 */
export function describeGroqError(status: number, raw: string): string {
  let message = ''
  let code = ''
  let failed = ''
  try {
    const err = (JSON.parse(raw) as { error?: Record<string, unknown> })?.error
    if (err) {
      // Drop Groq's upgrade pitch: useful to a buyer, noise in an error line.
      if (typeof err.message === 'string') message = err.message.replace(/\s*Need more tokens\?.*$/s, '').trim()
      if (typeof err.code === 'string') code = err.code
      if (typeof err.failed_generation === 'string') failed = err.failed_generation.trim()
    }
  } catch {
    // Not a Groq envelope — fall through to the raw excerpt below.
  }

  if (status === 401 || status === 403) {
    return 'Groq rejected the API key — check the key in Settings → Plugins → Issues.'
  }

  if (status === 429) {
    // "4m58.08s" → "4m58s". Groq quotes fractional seconds; nobody needs the fraction.
    const retry = /try again in (.+?s)\b/i
      .exec(message)?.[1]
      ?.replace(/(\d+)\.(\d+)s/, (_, s, f) => `${Math.round(Number(`${s}.${f}`))}s`)
    // A per-day limit can be half an hour out, so never imply it clears in seconds.
    const scope = /per day|\bTPD\b/i.test(message)
      ? ' (daily token limit)'
      : /per minute|\bTPM\b/i.test(message)
        ? ' (per-minute token limit)'
        : ''
    if (retry) return `Groq rate limit reached${scope} — try again in ${retry}.`
    return 'Groq rate limit reached — wait a few seconds and try Refine again.'
  }

  const detail = message || raw.slice(0, 200)
  const parts = [`Groq API error (${status})`, detail && `: ${detail}`]
  if (code) parts.push(` (${code})`)
  if (failed) parts.push(` — the model returned: ${failed.slice(0, 200)}`)
  return parts.filter(Boolean).join('')
}

// No response_format here by design — see the note above FORMAT_GUIDE. Replies are
// plain text and split locally, which keeps Markdown from corrupting the envelope.
async function callGroq(
  key: string,
  messages: Array<{ role: string; content: string }>,
  model: string,
): Promise<string> {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    const message = describeGroqError(response.status, await response.text().catch(() => ''))
    if (response.status === 429) throw new GroqRateLimitError(message)
    throw new Error(message)
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data?.choices?.[0]?.message?.content ?? ''
  if (!content) throw new Error('The AI returned an empty response.')
  return content
}

// Try the primary, then the backup — but only for a rate limit, whose budget is per model.
// Any other failure (a 400, an empty reply) would fail the same way on the backup, so it
// propagates untouched rather than burning a second call to learn nothing.
async function draftWithFallback(
  key: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  try {
    return await callGroq(key, messages, GROQ_MODEL)
  } catch (error) {
    if (!(error instanceof GroqRateLimitError)) throw error
    // Exactly one retry. A refused request costs no tokens, so the failed primary attempt
    // costs only its round trip. If the backup is capped too, its error carries a real
    // retry time — more useful than anything this layer could invent.
    return await callGroq(key, messages, GROQ_FALLBACK_MODEL)
  }
}

export async function refineWithGroq(
  key: string,
  text: string,
  context?: RepoContext,
): Promise<TicketDraft> {
  return parseDraft(
    await draftWithFallback(key, [
      { role: 'system', content: buildDraftPrompt(context, FORMAT_GUIDE) },
      { role: 'user', content: buildDraftMessage(text) },
    ]),
  )
}

export async function reviseWithGroq(key: string, input: ReviseInput): Promise<TicketDraft> {
  return parseDraft(
    await draftWithFallback(key, [
      { role: 'system', content: buildReviseDraftPrompt(input.context, FORMAT_GUIDE) },
      { role: 'user', content: buildReviseMessage(input) },
    ]),
  )
}
