/**
 * Pairs a name typed in the new-thread composer with the thread that send
 * created. The composer only learns that a send went through, and the server
 * hook only sees the thread, so each side reports what it knows and the first
 * pair in the same project within a short window wins.
 */

/** How far apart the send and the thread's first dispatch may land. */
export const WINDOW_MS = 30_000;

export interface Dispatch {
  threadId: string;
  projectId: string;
  at: number;
}

export interface Claim {
  projectId: string;
  title: string;
  at: number;
}

export interface Naming {
  threadId: string;
  title: string;
}

export class Matcher {
  private dispatches: Dispatch[] = [];
  private claims: Claim[] = [];

  /** A new thread's first message reached the server. */
  addDispatch(dispatch: Dispatch): Naming | null {
    this.prune(dispatch.at);
    const claim = this.claims.find((c) => c.projectId === dispatch.projectId);
    if (!claim) {
      this.dispatches.push(dispatch);
      return null;
    }
    this.claims.splice(this.claims.indexOf(claim), 1);
    return { threadId: dispatch.threadId, title: claim.title };
  }

  /** The composer sent a draft that had a name. */
  addClaim(claim: Claim): Naming | null {
    this.prune(claim.at);
    // The newest thread is the one this send just made.
    const dispatch = this.dispatches.findLast((d) => d.projectId === claim.projectId);
    if (!dispatch) {
      this.claims.push(claim);
      return null;
    }
    this.dispatches.splice(this.dispatches.indexOf(dispatch), 1);
    return { threadId: dispatch.threadId, title: claim.title };
  }

  private prune(now: number) {
    const fresh = (entry: { at: number }) => now - entry.at <= WINDOW_MS;
    this.dispatches = this.dispatches.filter(fresh);
    this.claims = this.claims.filter(fresh);
  }
}

/** The facts of a dispatch that tell a person's brand-new thread apart from everything else. */
export interface DispatchFacts {
  attempt: "join-turn" | "start-turn";
  initiator: string;
  senderThreadId: string | null;
  queuedCount: number;
  thread: { title: string | null; parentThreadId: string | null; createdAt: number };
}

/** A person's first message in a thread they just created and haven't named. */
export function isNewUserThread(facts: DispatchFacts, now: number): boolean {
  return (
    facts.attempt === "start-turn" &&
    facts.initiator === "user" &&
    facts.senderThreadId === null &&
    facts.queuedCount === 0 &&
    facts.thread.title === null &&
    facts.thread.parentThreadId === null &&
    now - facts.thread.createdAt <= WINDOW_MS
  );
}
