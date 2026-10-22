import { describe, expect, it } from "vitest";
import { isNewUserThread, Matcher, WINDOW_MS, type DispatchFacts } from "./match";

const dispatch = (threadId: string, at: number, projectId = "proj_a") => ({ threadId, projectId, at });
const claim = (title: string, at: number, projectId = "proj_a") => ({ title, projectId, at });

describe("Matcher", () => {
  it("names the thread when the send is reported after its dispatch", () => {
    const matcher = new Matcher();
    expect(matcher.addDispatch(dispatch("thr_1", 0))).toBeNull();
    expect(matcher.addClaim(claim("Fix login", 500))).toEqual({ threadId: "thr_1", title: "Fix login" });
  });

  it("names the thread when the send is reported first", () => {
    const matcher = new Matcher();
    expect(matcher.addClaim(claim("Fix login", 0))).toBeNull();
    expect(matcher.addDispatch(dispatch("thr_1", 500))).toEqual({ threadId: "thr_1", title: "Fix login" });
  });

  it("picks the newest thread in the same project", () => {
    const matcher = new Matcher();
    matcher.addDispatch(dispatch("thr_old", 0));
    matcher.addDispatch(dispatch("thr_other", 100, "proj_b"));
    matcher.addDispatch(dispatch("thr_new", 200));
    expect(matcher.addClaim(claim("Fix login", 300))?.threadId).toBe("thr_new");
  });

  it("uses each thread and each name once", () => {
    const matcher = new Matcher();
    matcher.addDispatch(dispatch("thr_1", 0));
    matcher.addClaim(claim("First", 10));
    expect(matcher.addClaim(claim("Second", 20))).toBeNull();
    expect(matcher.addDispatch(dispatch("thr_2", 30))).toEqual({ threadId: "thr_2", title: "Second" });
  });

  it("drops entries older than the window", () => {
    const matcher = new Matcher();
    matcher.addDispatch(dispatch("thr_1", 0));
    expect(matcher.addClaim(claim("Late", WINDOW_MS + 1))).toBeNull();
  });
});

describe("isNewUserThread", () => {
  const base: DispatchFacts = {
    attempt: "start-turn",
    initiator: "user",
    senderThreadId: null,
    queuedCount: 0,
    thread: { title: null, parentThreadId: null, createdAt: 1_000 },
  };

  it("accepts a person's first message in a fresh thread", () => {
    expect(isNewUserThread(base, 2_000)).toBe(true);
  });

  it.each<[string, Partial<DispatchFacts>]>([
    ["a steer into a running turn", { attempt: "join-turn" }],
    ["an agent's message", { initiator: "agent" }],
    ["a thread spawned by another thread", { senderThreadId: "thr_parent" }],
    ["a drained queue row", { queuedCount: 1 }],
    ["a named thread", { thread: { ...base.thread, title: "Named" } }],
    ["a child thread", { thread: { ...base.thread, parentThreadId: "thr_parent" } }],
  ])("rejects %s", (_, change) => {
    expect(isNewUserThread({ ...base, ...change }, 2_000)).toBe(false);
  });

  it("rejects an old thread", () => {
    expect(isNewUserThread(base, 1_000 + WINDOW_MS + 1)).toBe(false);
  });
});
