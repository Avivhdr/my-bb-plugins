import { describe, expect, it } from "vitest";
import { project, thread } from "./fixtures";
import { visibleItems, type ListOptions } from "./list-model";
import type { PrSummary } from "./pr-insight";
import { tabFor, threadsWithActiveDescendant } from "./tabs";

const defaults: ListOptions = {
  tab: "all",
  mode: "project",
  lifecycles: ["active"],
  sort: "updated",
  direction: "desc",
  collapsedGroups: [],
  collapsedThreads: [],
};
const titles = (items: ReturnType<typeof visibleItems>) =>
  items.filter((item) => item.kind === "thread").map((item) => item.thread.displayTitle);

const rows = [
  thread({ id: "parent", displayTitle: "Parent", updatedAt: 300 }),
  thread({ id: "child", displayTitle: "Child", parentThreadId: "parent", updatedAt: 400 }),
  thread({ id: "pin", displayTitle: "Pin", isPinned: true, pinnedAt: 10, pinSortKey: "a" }),
  thread({ id: "hidden", displayTitle: "Hidden", isHidden: true }),
  thread({ id: "arch", displayTitle: "Archived", isArchived: true, archivedAt: 400 }),
];

describe("visibleItems", () => {
  it("places pinned rows once and nests children beneath the parent", () => {
    const items = visibleItems(rows, [project], [], defaults);
    expect(titles(items)).toEqual(["Pin", "Parent", "Child"]);
    expect(
      items.find((item) => item.kind === "thread" && item.thread.id === "child"),
    ).toMatchObject({ depth: 1 });
    expect(items.filter((item) => item.kind === "thread" && item.thread.id === "pin")).toHaveLength(
      1,
    );
  });

  it("hides descendants or groups when collapsed, and keeps hidden threads out", () => {
    expect(
      titles(visibleItems(rows, [project], [], { ...defaults, collapsedThreads: ["parent"] })),
    ).toEqual(["Pin", "Parent"]);
    expect(
      titles(visibleItems(rows, [project], [], { ...defaults, collapsedGroups: ["project:p1"] })),
    ).toEqual(["Pin"]);
  });

  it("groups by machine, projects, and custom sections with stable fallback", () => {
    const scoped = [
      thread({ id: "machine", host: { id: "m1", name: "Mac" }, sectionId: "s1" }),
      thread({ id: "loose", displayTitle: "Loose", projectId: "missing", updatedAt: 1 }),
    ];
    expect(
      visibleItems(scoped, [project], [], defaults).map((x) =>
        x.kind === "group" ? x.label : x.thread.id,
      ),
    ).toEqual(["Sample project", "machine", "Threads", "loose"]);
    expect(
      visibleItems(scoped, [project], [], { ...defaults, mode: "machine" }).some(
        (x) => x.kind === "group" && x.label === "Mac",
      ),
    ).toBe(true);
    expect(
      visibleItems(scoped, [project], [{ id: "s1", name: "Later", createdAt: 1, updatedAt: 1 }], {
        ...defaults,
        mode: "section",
      }).map((x) => (x.kind === "group" ? x.label : x.thread.id)),
    ).toEqual(["Later", "machine", "Threads", "loose"]);
  });

  it("supports sorting and archive lifecycle without duplicating pinned children", () => {
    const items = visibleItems(rows, [project], [], {
      ...defaults,
      sort: "title",
      direction: "asc",
      lifecycles: ["active", "archived"],
    });
    expect(titles(items)).toContain("Archived");
    expect(titles(items)).not.toContain("Hidden");
    const pinnedChild = thread({
      id: "pinnedChild",
      displayTitle: "Pinned child",
      parentThreadId: "parent",
      isPinned: true,
      pinnedAt: 11,
    });
    expect(
      titles(visibleItems([...rows, pinnedChild], [project], [], defaults)).filter(
        (t) => t === "Pinned child",
      ),
    ).toHaveLength(1);
  });
  it("retains empty sections for scoped creation and collapse", () => {
    const sections = [
      { id: "s1", name: "Empty", createdAt: 1, updatedAt: 1 },
      { id: "s2", name: "Populated", createdAt: 2, updatedAt: 2 },
    ];
    const items = visibleItems([thread({ sectionId: "s2" })], [project], sections, {
      ...defaults,
      mode: "section",
    });
    expect(items.filter((item) => item.kind === "group")).toMatchObject([
      { id: "section:s1", label: "Empty", count: 0 },
      { id: "section:s2", label: "Populated", count: 1 },
    ]);
    expect(
      visibleItems([], [project], sections, {
        ...defaults,
        mode: "section",
        collapsedGroups: ["section:s1"],
      }),
    ).toMatchObject([
      { kind: "group", id: "section:s1", count: 0, collapsed: true },
      { kind: "group", id: "section:s2", count: 0, collapsed: false },
    ]);
  });
  it("derives thousands of rows without losing entries or mutating host arrays", () => {
    const many = Array.from({ length: 3000 }, (_, index) =>
      thread({ id: `t${index}`, displayTitle: `Thread ${index}`, updatedAt: index }),
    );
    const items = visibleItems(many, [project], [], defaults);
    expect(items[0]).toMatchObject({ kind: "group", count: 3000 });
    expect(items).toHaveLength(3001);
    expect(items[1]).toMatchObject({ kind: "thread", id: "t2999" });
    expect(many[0]?.id).toBe("t0");
  });
  it("lifts whole trees with a thread that needs the user into a first Needs you group", () => {
    const other = { ...project, id: "p2", name: "Other project" };
    const items = visibleItems(
      [
        thread({ id: "parent", displayTitle: "Parent", isUnread: true }),
        thread({
          id: "asks",
          displayTitle: "Asks",
          parentThreadId: "parent",
          indicator: "waiting-for-input",
        }),
        thread({ id: "failed", displayTitle: "Failed", projectId: "p2", queuedWork: "failed" }),
        thread({
          id: "approval",
          displayTitle: "Approval",
          isPinned: true,
          pinnedAt: 1,
          hasPendingInteraction: true,
        }),
      ],
      [project, other],
      [],
      defaults,
    );
    expect(items[0]).toMatchObject({
      kind: "group",
      id: "attention",
      label: "Needs you",
      count: 4,
    });
    expect(
      items.slice(1).map((item) => (item.kind === "thread" ? [item.thread.id, item.depth] : null)),
    ).toEqual([
      ["approval", 0],
      ["failed", 0],
      ["parent", 0],
      ["asks", 1],
    ]);
    expect(items.filter((item) => item.kind === "group").map((item) => item.id)).toEqual([
      "attention",
    ]);
  });

  describe("thread trees", () => {
    const shape = (items: ReturnType<typeof visibleItems>) =>
      items.map((item) =>
        item.kind === "group"
          ? `#${item.id}`
          : `${"-".repeat(item.depth)}${item.id}${item.context ? "?" : ""}`,
      );

    it("nests children at every depth", () => {
      expect(
        shape(
          visibleItems(
            [
              thread({ id: "top" }),
              thread({ id: "mid", parentThreadId: "top" }),
              thread({ id: "leaf", parentThreadId: "mid" }),
            ],
            [project],
            [],
            defaults,
          ),
        ),
      ).toEqual(["#project:p1", "top", "-mid", "--leaf"]);
    });

    it("shows a child of a hidden parent as a top-level row", () => {
      expect(
        shape(
          visibleItems(
            [
              thread({ id: "secret", isHidden: true }),
              thread({ id: "orphan", parentThreadId: "secret" }),
            ],
            [project],
            [],
            defaults,
          ),
        ),
      ).toEqual(["#project:p1", "orphan"]);
    });

    it("cuts one link of a parent cycle and keeps every thread once", () => {
      expect(
        shape(
          visibleItems(
            [
              thread({ id: "tail", parentThreadId: "a" }),
              thread({ id: "a", parentThreadId: "b" }),
              thread({ id: "b", parentThreadId: "c" }),
              thread({ id: "c", parentThreadId: "a" }),
              thread({ id: "self", parentThreadId: "self" }),
            ],
            [project],
            [],
            defaults,
          ),
        ),
      ).toEqual(["#project:p1", "a", "-c", "--b", "-tail", "self"]);
    });

    it("shows a loaded ancestor that the lifecycle selection leaves out as an uncounted context row", () => {
      const rows = [
        thread({ id: "live" }),
        thread({ id: "done", parentThreadId: "live", isArchived: true, archivedAt: 1 }),
      ];
      const items = visibleItems(rows, [project], [], { ...defaults, lifecycles: ["archived"] });
      expect(shape(items)).toEqual(["#project:p1", "live?", "-done"]);
      expect(items[0]).toMatchObject({ count: 1 });
      expect(
        shape(
          visibleItems(rows, [project], [], { ...defaults, lifecycles: ["active", "archived"] }),
        ),
      ).toEqual(["#project:p1", "live", "-done"]);
    });

    it("drops a tree with no thread that the selection shows", () => {
      const rows = [
        thread({ id: "gone", isArchived: true, archivedAt: 1 }),
        thread({ id: "goneChild", parentThreadId: "gone", isArchived: true, archivedAt: 1 }),
      ];
      expect(shape(visibleItems(rows, [project], [], defaults))).toEqual([]);
    });

    it("lets the top thread decide the pinned and organization group", () => {
      const other = { ...project, id: "p2", name: "Other project" };
      const sections = [
        { id: "s1", name: "One", createdAt: 1, updatedAt: 1 },
        { id: "s2", name: "Two", createdAt: 2, updatedAt: 2 },
      ];
      const rows = [
        thread({ id: "root", sectionId: "s1" }),
        thread({ id: "pinnedChild", parentThreadId: "root", isPinned: true, pinnedAt: 1 }),
        thread({ id: "elsewhere", parentThreadId: "root", projectId: "p2", sectionId: "s2" }),
        thread({ id: "pinnedRoot", isPinned: true, pinnedAt: 2, projectId: "p2" }),
        thread({ id: "pinnedRootChild", parentThreadId: "pinnedRoot" }),
      ];
      expect(shape(visibleItems(rows, [project, other], [], defaults))).toEqual([
        "#pinned",
        "pinnedRoot",
        "-pinnedRootChild",
        "#project:p1",
        "root",
        "-elsewhere",
        "-pinnedChild",
      ]);
      expect(
        shape(visibleItems(rows, [project, other], sections, { ...defaults, mode: "section" })),
      ).toEqual([
        "#pinned",
        "pinnedRoot",
        "-pinnedRootChild",
        "#section:s1",
        "root",
        "-elsewhere",
        "-pinnedChild",
        "#section:s2",
      ]);
      const hosted = rows.map((row) =>
        row.id === "elsewhere"
          ? { ...row, host: { id: "m2", name: "Other Mac" } }
          : { ...row, host: { id: "m1", name: "Mac" } },
      );
      expect(
        shape(visibleItems(hosted, [project, other], [], { ...defaults, mode: "machine" })),
      ).toEqual([
        "#pinned",
        "pinnedRoot",
        "-pinnedRootChild",
        "#machine:m1",
        "root",
        "-elsewhere",
        "-pinnedChild",
      ]);
    });
  });

  describe("attention tabs", () => {
    const running: PrSummary = {
      number: 1,
      url: "https://example.com/pull/1",
      state: "open",
      failedChecks: 0,
      passedChecks: 0,
      runningChecks: 1,
      waitingChecks: 0,
      pendingReviews: 0,
      blockers: ["checks_running"],
      failedNames: [],
      pendingNames: [],
      mergeQueue: null,
    };
    const other = { ...project, id: "p2", name: "Other project" };
    const tabRows = [
      thread({ id: "idle", displayTitle: "Idle" }),
      thread({ id: "busy", displayTitle: "Busy", status: "active" }),
      thread({ id: "waits", displayTitle: "Waits on CI", projectId: "p2" }),
      thread({
        id: "child",
        displayTitle: "Child asks",
        parentThreadId: "busy",
        indicator: "waiting-for-input",
      }),
      thread({ id: "pin", displayTitle: "Pin", isPinned: true, pinnedAt: 1, isUnread: true }),
      thread({ id: "arch", displayTitle: "Archived", isArchived: true, archivedAt: 1 }),
      thread({ id: "hidden", displayTitle: "Hidden", isHidden: true }),
    ];
    const prs = new Map([["waits", running]]);
    const tab = (name: "attention" | "inflight", extra: Partial<ListOptions> = {}) =>
      visibleItems(tabRows, [project, other], [], { ...defaults, tab: name, ...extra }, prs);

    it("puts each active thread in one tab and keeps archived and hidden threads out", () => {
      expect(titles(tab("attention"))).toEqual(["Pin", "Busy", "Child asks", "Idle"]);
      expect(titles(tab("inflight"))).toEqual(["Waits on CI"]);
      expect(titles(tab("attention", { lifecycles: ["archived"] }))).not.toContain("Archived");
    });
    it("keeps pinned first, nests a child under a parent whose own tab differs, and shows no Needs you group", () => {
      const items = tab("attention");
      expect(items.filter((item) => item.kind === "group").map((item) => item.id)).toEqual([
        "pinned",
        "project:p1",
      ]);
      expect(items.find((item) => item.kind === "thread" && item.id === "child")).toMatchObject({
        depth: 1,
      });
    });
    it("moves a whole tree to the tab of its most urgent member", () => {
      const tree = (leaf: Partial<Parameters<typeof thread>[0]>) => [
        thread({ id: "top", displayTitle: "Top", status: "active" }),
        thread({ id: "mid", displayTitle: "Mid", parentThreadId: "top", status: "active" }),
        thread({ id: "leaf", displayTitle: "Leaf", parentThreadId: "mid", ...leaf }),
      ];
      const view = (rows: ReturnType<typeof tree>, name: "attention" | "inflight") =>
        titles(
          visibleItems(
            rows,
            [project],
            [],
            { ...defaults, tab: name },
            new Map([["leaf", running]]),
          ),
        );
      expect(view(tree({ isUnread: true }), "attention")).toEqual(["Top", "Mid", "Leaf"]);
      expect(view(tree({ isUnread: true }), "inflight")).toEqual([]);
      expect(view(tree({ isUnread: false }), "attention")).toEqual([]);
      expect(view(tree({ isUnread: false }), "inflight")).toEqual(["Top", "Mid", "Leaf"]);
    });
    describe("a running parent with finished children", () => {
      const settled = (pr: Partial<PrSummary>): PrSummary => ({
        ...running,
        runningChecks: 0,
        blockers: [],
        ...pr,
      });
      const rows = [
        thread({
          id: "parent",
          displayTitle: "Parent",
          activity: {
            workflows: 0,
            backgroundAgents: 0,
            backgroundCommands: 1,
            planMode: 0,
            goals: 0,
          },
        }),
        thread({
          id: "working",
          displayTitle: "Working",
          parentThreadId: "parent",
          status: "active",
        }),
        thread({ id: "noPr", displayTitle: "No PR", parentThreadId: "parent" }),
        thread({ id: "done", displayTitle: "Done", parentThreadId: "parent" }),
      ];
      const tree = ["Parent", "Working", "Done", "No PR"];
      const view = (name: "attention" | "inflight", donePr: PrSummary) =>
        titles(
          visibleItems(
            rows,
            [project],
            [],
            { ...defaults, tab: name },
            new Map([["done", donePr]]),
          ),
        );

      it.each([
        ["merged", settled({ state: "merged" })],
        ["ready to merge", settled({})],
        [
          "queued with stale problem blockers",
          settled({ blockers: ["checks_failed"], mergeQueue: { position: 1, state: "queued" } }),
        ],
      ])("stays in flight when a child has no PR and another has a %s PR", (_, donePr) => {
        expect(view("attention", donePr)).toEqual([]);
        expect(view("inflight", donePr)).toEqual(tree);
      });
      it.each([
        ["conflicts", settled({ blockers: ["conflicts"] })],
        ["failed checks", settled({ failedChecks: 1, blockers: ["checks_failed"] })],
        ["requested changes", settled({ blockers: ["changes_requested"] })],
        ["unresolved comments", settled({ blockers: ["unresolved_threads"] })],
        ["a failed merge queue entry", settled({ mergeQueue: { position: 1, state: "failed" } })],
      ])("stays in flight when an idle child has %s", (_, problem) => {
        expect(view("attention", problem)).toEqual([]);
        expect(view("inflight", problem)).toEqual(tree);
      });
    });
    it("lets an idle top thread without a PR decide Needs attention", () => {
      const rows = [
        thread({ id: "top", displayTitle: "Top" }),
        thread({ id: "kid", displayTitle: "Kid", parentThreadId: "top" }),
      ];
      expect(titles(visibleItems(rows, [project], [], { ...defaults, tab: "attention" }))).toEqual([
        "Top",
        "Kid",
      ]);
      expect(titles(visibleItems(rows, [project], [], { ...defaults, tab: "inflight" }))).toEqual(
        [],
      );
    });
    it("shows a parent whose own tab is In flight in Needs attention with its child that needs the user", () => {
      const rows = [
        thread({ id: "parent", displayTitle: "Parent" }),
        thread({
          id: "asks",
          displayTitle: "Asks",
          parentThreadId: "parent",
          hasPendingInteraction: true,
        }),
      ];
      expect(tabFor(rows[0]!, null, threadsWithActiveDescendant(rows).has("parent"))).toBe(
        "inflight",
      );
      expect(titles(visibleItems(rows, [project], [], { ...defaults, tab: "attention" }))).toEqual([
        "Parent",
        "Asks",
      ]);
      expect(titles(visibleItems(rows, [project], [], { ...defaults, tab: "inflight" }))).toEqual(
        [],
      );
    });
    it("puts a parent in flight while a descendant is active, and ignores archived descendants", () => {
      const rows = [
        thread({ id: "parent", displayTitle: "Parent" }),
        thread({ id: "mid", displayTitle: "Mid", parentThreadId: "parent" }),
        thread({ id: "leaf", displayTitle: "Leaf", parentThreadId: "mid", status: "active" }),
        thread({ id: "lonely", displayTitle: "Lonely" }),
        thread({
          id: "gone",
          displayTitle: "Gone",
          parentThreadId: "lonely",
          status: "active",
          isArchived: true,
          archivedAt: 1,
        }),
      ];
      const view = (name: "attention" | "inflight") =>
        visibleItems(rows, [project], [], { ...defaults, tab: name });
      expect(titles(view("attention"))).toEqual(["Lonely"]);
      expect(titles(view("inflight"))).toEqual(["Parent", "Mid", "Leaf"]);
    });
    it("groups the threads of a tab by project", () => {
      const rows = [
        thread({ id: "waits", projectId: "p2" }),
        thread({ id: "busy", status: "active" }),
      ];
      expect(
        visibleItems(rows, [project, other], [], { ...defaults, tab: "inflight" }, prs).map(
          (item) => (item.kind === "group" ? item.label : item.id),
        ),
      ).toEqual(["Other project", "waits", "Sample project", "busy"]);
    });
  });
});

describe("snoozed threads", () => {
  const snoozed = new Map([["snoozed", 9_000]]);
  const labels = (items: ReturnType<typeof visibleItems>) =>
    items.map((item) => (item.kind === "group" ? `[${item.label}]` : item.thread.displayTitle));

  it("show only in a Snoozed group at the bottom of All", () => {
    const threads = [
      thread({ id: "plain", displayTitle: "Plain" }),
      thread({ id: "snoozed", displayTitle: "Snoozed one" }),
      thread({ id: "loose", displayTitle: "Loose", projectId: "missing" }),
    ];

    expect(labels(visibleItems(threads, [project], [], defaults, new Map(), snoozed))).toEqual([
      "[Sample project]",
      "Plain",
      "[Threads]",
      "Loose",
      "[Snoozed]",
      "Snoozed one",
    ]);
  });

  it("leave the Pinned group when pinned", () => {
    const threads = [
      thread({ id: "snoozed", displayTitle: "Snoozed pin", isPinned: true, pinnedAt: 1 }),
    ];

    expect(labels(visibleItems(threads, [project], [], defaults, new Map(), snoozed))).toEqual([
      "[Snoozed]",
      "Snoozed pin",
    ]);
  });

  it("collapse with the Snoozed group", () => {
    const threads = [thread({ id: "snoozed", displayTitle: "Snoozed one" })];

    expect(
      labels(
        visibleItems(
          threads,
          [project],
          [],
          { ...defaults, collapsedGroups: ["snoozed"] },
          new Map(),
          snoozed,
        ),
      ),
    ).toEqual(["[Snoozed]"]);
  });

  it.each(["attention", "inflight"] as const)("do not show in the %s tab", (tab) => {
    const threads = [
      thread({ id: "snoozed", displayTitle: "Snoozed one" }),
      thread({ id: "busy", status: "active", displayTitle: "Busy" }),
      thread({ id: "snoozedBusy", status: "active", displayTitle: "Snoozed busy" }),
    ];
    const both = new Map([
      ["snoozed", 9_000],
      ["snoozedBusy", 9_000],
    ]);

    expect(
      titles(visibleItems(threads, [project], [], { ...defaults, tab }, new Map(), both)),
    ).toEqual(tab === "inflight" ? ["Busy"] : []);
  });

  it("leave the tree of an awake parent, which shows as a dimmed row in Snoozed", () => {
    const threads = [
      thread({ id: "parent", displayTitle: "Parent" }),
      thread({ id: "snoozed", displayTitle: "Snoozed child", parentThreadId: "parent" }),
    ];
    const items = visibleItems(threads, [project], [], defaults, new Map(), snoozed);

    expect(labels(items)).toEqual([
      "[Sample project]",
      "Parent",
      "[Snoozed]",
      "Parent",
      "Snoozed child",
    ]);
    expect(items.filter((item) => item.kind === "thread").map((item) => item.context)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("show as a dimmed parent above an awake child in its tab", () => {
    const threads = [
      thread({ id: "snoozed", displayTitle: "Snoozed parent" }),
      thread({ id: "child", displayTitle: "Child", parentThreadId: "snoozed", isUnread: true }),
    ];
    const items = visibleItems(
      threads,
      [project],
      [],
      { ...defaults, tab: "attention" },
      new Map(),
      snoozed,
    );

    expect(
      items
        .filter((item) => item.kind === "thread")
        .map((item) => [item.thread.displayTitle, item.context]),
    ).toEqual([
      ["Snoozed parent", true],
      ["Child", false],
    ]);
  });

  it("add no Snoozed group when nothing is snoozed", () => {
    expect(labels(visibleItems([thread()], [project], [], defaults))).not.toContain("[Snoozed]");
  });
  it("keeps an entire captured subtree nested only in Snoozed, then restores normal tab classification", () => {
    const threads = [
      thread({ id: "parent", displayTitle: "Parent", status: "active", isPinned: true }),
      thread({ id: "child", displayTitle: "Child", parentThreadId: "parent", projectId: "other" }),
      thread({ id: "grandchild", displayTitle: "Grandchild", parentThreadId: "child" }),
    ];
    const group = new Map(threads.map(({ id }) => [id, 9_000]));
    const view = (tab: ListOptions["tab"], snoozed = group, extra: Partial<ListOptions> = {}) =>
      visibleItems(threads, [project], [], { ...defaults, tab, ...extra }, new Map(), snoozed);
    expect(view("attention")).toEqual([]);
    expect(view("inflight")).toEqual([]);
    expect(labels(view("all"))).toEqual(["[Snoozed]", "Parent", "Child", "Grandchild"]);
    expect(
      view("all")
        .filter((row) => row.kind === "thread")
        .map((row) => [row.id, row.depth, row.context]),
    ).toEqual([
      ["parent", 0, false],
      ["child", 1, false],
      ["grandchild", 2, false],
    ]);
    expect(labels(view("all", group, { collapsedThreads: ["parent"] }))).toEqual([
      "[Snoozed]",
      "Parent",
    ]);
    expect(titles(view("attention", new Map()))).toEqual([]);
    expect(titles(view("inflight", new Map()))).toEqual(["Parent", "Child", "Grandchild"]);
  });

  it("keeps ancestor context for an awake child outside the captured group", () => {
    const threads = [
      thread({ id: "parent", displayTitle: "Parent" }),
      thread({ id: "child", displayTitle: "Child", parentThreadId: "parent" }),
      thread({ id: "new", displayTitle: "New child", parentThreadId: "child", isUnread: true }),
    ];
    const group = new Map([
      ["parent", 9_000],
      ["child", 9_000],
    ]);
    const items = visibleItems(
      threads,
      [project],
      [],
      { ...defaults, tab: "attention" },
      new Map(),
      group,
    );
    expect(
      items.filter((row) => row.kind === "thread").map((row) => [row.id, row.context]),
    ).toEqual([
      ["parent", true],
      ["child", true],
      ["new", false],
    ]);
  });
});
