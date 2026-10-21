// The prompt that turns a rough note into a well-formed issue draft, and the types
// that ride with it. Provider-neutral: both the Anthropic and the Groq client build
// their request from exactly this, so a wording change lands on both at once.
//
// Ported from the github-roadmap reference implementation (src/lib/groq/client.ts),
// which remains the source of truth for the wording.

/** A compact, model-facing snapshot of the repo, used to ground drafts. */
export interface RepoContext {
  /** owner/name */
  repo: string
  description: string | null
  /** Plain-text excerpt, possibly truncated. */
  readme: string
  labels: string[]
}

export interface TicketDraft {
  title: string
  body: string
}

export interface ReviseInput {
  draft: TicketDraft
  feedback: string
  /** The original rough note, kept as extra grounding. */
  note?: string
  context?: RepoContext
}

// Optional repo grounding, shared by the draft and revise prompts.
function contextBlock(context?: RepoContext): string {
  if (!context) return ''
  const parts: string[] = [`- Repository: ${context.repo}`]
  if (context.description) parts.push(`- Description: ${context.description}`)
  if (context.labels.length) parts.push(`- Existing labels: ${context.labels.slice(0, 40).join(', ')}`)
  if (context.readme) parts.push(`- README excerpt:\n"""\n${context.readme}\n"""`)
  return `

Repository context — use it to ground the issue in this project's real terminology and how it actually works. Do not repeat it verbatim and do not contradict it:
${parts.join('\n')}`
}

// Title style. In the reference implementation these rules rode along inside the
// delimited format guide. They are style, not envelope mechanics, so they live on
// their own and apply whichever way a provider is asked to shape its reply.
const TITLE_GUIDE = `The title is a concise, actionable title in the imperative mood, no more than ~80 characters, with no trailing period. Write it as a sentence, not a headline — capitalize only the first word and any proper nouns, e.g. "Add up/down buttons to navigate comments", never "Add Up/Down Buttons To Navigate Comments".`

// The shape and faithfulness rules for the issue body, reused by both prompts.
// Each section name is given as a literal "## " heading: naming the heading inline is
// what keeps the model from inventing one for the issue type (a "## Feature" wrapper)
// and from demoting the real sections into bullets.
//
// "## Problem" is a named section rather than an aside inside Summary because it used to
// be one ("a short ## Summary (the goal and why it matters)") and the model reliably
// dropped the why: it writes to the heading and skims the parenthetical. Summary now owns
// only the what, so the why has nowhere to hide.
const BODY_GUIDE = `Pick the sections that fit the note. Give every section its own "##" heading, exactly as named below, and never add a heading for the issue type itself:
- Feature / task / idea — "## Problem" first, then a short "## Summary" (what this changes), "## Details" or "## Proposed approach" as bullet points, and "## Acceptance criteria" as a "- [ ]" checklist.
- Bug — "## Summary", "## Steps to reproduce" (numbered), "## Expected behavior", and "## Actual behavior". A bug gets no "## Problem" section: expected vs actual behavior already states the problem.

"## Problem" comes first and is one or two sentences on what the reader runs into today and why that hurts. Describe the situation, never the absence of the feature: write "Finding where a long reply started means scrolling up through it slowly", never "Users cannot jump to the previous message" — restating the request as a lack tells the reader nothing they did not already know from the title. If the note does not give the problem, infer the most plausible one from the note and the repository context, and ask about it under "## Open questions".

Add a short "## Open questions" list when the note leaves genuine ambiguity. Stay faithful to the note: expand and structure it, but do not fabricate specific facts (numbers, file names, deadlines, external systems, APIs) that the note or repository context does not support — raise assumptions under Open questions instead. Write concrete, checkable statements; never pad with generic benefits or filler. Do not include labels, assignees, or other metadata.`

/**
 * Assemble a system prompt.
 *
 * `envelope` describes how the reply must be shaped, and only a provider that cannot
 * be held to a schema needs one: Anthropic constrains the reply with a JSON schema and
 * passes nothing, while Groq is asked for a delimited plain-text reply and passes its
 * format guide. Everything else about the prompt is identical either way.
 */
function buildPrompt(options: {
  task: string
  instruction?: string
  context?: RepoContext
  envelope?: string
}): string {
  const blocks = [`${options.task}${contextBlock(options.context)}`]
  if (options.instruction) blocks.push(options.instruction)
  if (options.envelope) blocks.push(options.envelope)
  blocks.push(TITLE_GUIDE, BODY_GUIDE)
  return blocks.join('\n\n')
}

/** Draft prompt. Pure and exported so the prompt can be unit-tested. */
export function buildDraftPrompt(context?: RepoContext, envelope?: string): string {
  return buildPrompt({
    task: "You turn a developer's rough note into a single, well-structured GitHub issue.",
    context,
    envelope,
  })
}

/**
 * Revise prompt: edit an EXISTING draft per the author's feedback instead of drafting
 * from scratch — the model keeps what already works and changes only what's asked.
 */
export function buildReviseDraftPrompt(context?: RepoContext, envelope?: string): string {
  return buildPrompt({
    task: "You revise an existing GitHub issue draft based on the author's feedback.",
    instruction:
      "Apply the feedback to the current draft: keep what already works, change what the feedback asks for, and don't drop sections the feedback didn't mention.",
    context,
    envelope,
  })
}

/** The user turn for a draft: the rough note to expand. */
export function buildDraftMessage(text: string): string {
  return `Turn this note into an issue:\n\n"""${text}"""`
}

/**
 * The user turn for a revision: the current draft, the feedback to apply, and the
 * original note for context. Pure/exported so the wiring can be unit-tested.
 */
export function buildReviseMessage({ draft, feedback, note }: ReviseInput): string {
  const parts = [
    'Revise this issue draft.',
    '',
    `Current title: ${draft.title}`,
    '',
    'Current body:',
    `"""${draft.body}"""`,
    '',
    "Author's feedback to apply:",
    `"""${feedback}"""`,
  ]
  if (note && note.trim()) parts.push('', 'Original note (for context):', `"""${note.trim()}"""`)
  parts.push('', 'Return the revised title and body.')
  return parts.join('\n')
}
