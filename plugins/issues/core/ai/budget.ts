// How long a Refine may take before the transport gives up on it.
//
// The create dialog waits on the Refine RPC with a spinner, so the budget is a
// latency bound for the user as much as a guard against a stuck connection. Every
// attempt a transport makes has to fit inside it, retries included: a fallback that
// starts after the budget is spent only makes the dialog wait longer for a failure.

/** The longest a Refine RPC should keep the dialog waiting. */
export const HOST_DEADLINE_MS = 30_000

// Refine also reads the repo README and pays an RPC round trip either side of the
// model call, none of which is free. Leave that outside the model's own budget.
const OVERHEAD_MS = 5_000

/** The wall clock a transport may spend on model calls, retries included. */
export const AI_BUDGET_MS = HOST_DEADLINE_MS - OVERHEAD_MS
