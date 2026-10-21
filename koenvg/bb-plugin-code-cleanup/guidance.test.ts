import { describe, expect, it } from "vitest";
import { defaultGuidance } from "./guidance";

describe("default Code Cleanup guidance", () => {
  it("records substantial adjacent follow-ups through a single linked BB tracker", () => {
    const text = defaultGuidance("proj_example");
    expect(text).toMatch(/substantial.*actionable/i);
    expect(text).toMatch(/files you edit.*adjacent code/i);
    expect(text).toMatch(/minor.*style|style.*nit/i);
    expect(text).toContain("bb tasks");
    expect(text).toContain("project list");
    expect(text).toContain("linkedBbProjectId");
    expect(text).toContain("proj_example");
    expect(text).toMatch(/single.*tracker/i);
    expect(text).toMatch(/prefix or.*ID/i);
    expect(text).toContain("never a proj_");
    for (const status of ["backlog", "todo", "in_progress", "in_review"])
      expect(text).toContain(status);
    expect(text).toContain("nextCursor");
    expect(text).toMatch(/every.*page/i);
    expect(text).toMatch(/same filters/i);
    expect(text).toMatch(/inspect.*reuse/i);
    expect(text).toContain("create");
    expect(text).toMatch(/title.*description/i);
    for (const field of [
      "location",
      "evidence",
      "problem",
      "desired outcome",
      "completion criteria",
      "source task",
      "bbthread://",
    ])
      expect(text).toContain(field);
    expect(text).toContain("label list");
    expect(text).toMatch(/existing labels/i);
    expect(text).toMatch(/required blockers.*verified.*keys/i);
    expect(text).toMatch(/unavailable/i);
    expect(text).toMatch(/missing.*ambiguous/i);
    expect(text).toMatch(/candidate.*error|candidate.*limit/i);
    expect(text).toMatch(/confirmed.*key/i);
    expect(text).toMatch(/failed.*dependency.*incomplete/i);
    expect(text).toMatch(/no.*unrelated cleanup.*dispatch.*notification.*status/i);
    expect(text).not.toMatch(/bb task-board|\bopenforge\b|--\w/);
  });

  it("makes merge-dependent cleanup wait for the current ticket, not the reverse", () => {
    const text = defaultGuidance("proj_example");
    expect(text).toMatch(/if.*new cleanup.*current change.*merge/i);
    expect(text).toMatch(/save.*new ticket as blocked by the current ticket/i);
    expect(text).toMatch(/never make the current ticket wait for.*cleanup/i);
    expect(text).toMatch(/only required blockers.*verified.*keys/i);
    expect(text).toMatch(/missing keys.*incomplete recording/i);
    expect(text).toMatch(/failed.*dependency writes.*incomplete recording/i);
    expect(text).toMatch(/report.*confirmed.*key/i);
    expect(text).toMatch(/report.*error.*never claim success/i);
  });

  it("requires current evidence and benefit, and permits no cleanup findings", () => {
    const text = defaultGuidance("proj_example");
    expect(text).toContain("observed defects or concrete maintenance costs");
    expect(text).toContain("current evidence and expected benefit");
    expect(text).toContain("name the current change that is difficult");
    expect(text).toContain("how cleanup makes it easier");
    expect(text).toContain("No cleanup findings is a valid result.");
    expect(text).toContain("Prefer removing unnecessary code");
    expect(text).toContain("A possible edge case alone does not justify a task.");
  });

  it("defines short human and agent sections without losing required context", () => {
    const text = defaultGuidance("proj_example");
    expect(text).toContain("80 words");
    expect(text).toContain("120 words");
    expect(text).toContain("whitespace-delimited");
    expect(text).toContain("no minimum");
    expect(text).toContain("up to three completion criteria");
    expect(text).toContain("State each fact once");
    expect(text).toContain("required safeguards");
    expect(text).toContain("briefly explain any overrun");
    expect(text).toContain("uncertain causes");
    expect(text).toContain("retrievable");
    expect(text).toContain("task attachments");
    expect(text).toContain("evidence cannot be shared");
  });

  it("demonstrates three illustrative follow-ups within the section budgets", () => {
    const text = defaultGuidance("proj_example");
    expect(text).toContain("Illustrative examples");
    expect(text).toContain("Replace placeholders with verified values");
    for (const kind of ["Defect", "Maintenance", "Investigation"]) {
      expect(text).toContain(`### ${kind}:`);
    }
    const examples = [...text.matchAll(/```markdown\n([\s\S]*?)```/g)];
    expect(examples).toHaveLength(3);
    for (const [, example] of examples) {
      const sections = example!.match(/^## Summary\n([\s\S]+?)\n## Agent context\n([\s\S]+)$/);
      expect(sections).not.toBeNull();
      const [, summary, context] = sections!;
      const wordCount = (value: string) => value.trim().split(/\s+/).length;
      expect(wordCount(summary!)).toBeLessThanOrEqual(80);
      expect(wordCount(context!)).toBeLessThanOrEqual(120);
      expect(summary!.match(/^- /gm)?.length).toBeGreaterThanOrEqual(1);
      expect(summary!.match(/^- /gm)?.length).toBeLessThanOrEqual(3);
      expect(context).toContain("Evidence:");
      expect(context).toContain("Source:");
      expect(context).toMatch(/\[[^\]]+\]/);
    }
    expect(examples[1]![1]).toContain("required matching edits in three parsers");
    expect(examples[2]![1]).toContain("not a proven cause");
  });

  it("is concise and below the instruction limit for real project IDs", () => {
    for (const id of ["proj_example", "proj_gjz4e6jtmg", `proj_${"x".repeat(64)}`]) {
      expect(defaultGuidance(id).length).toBeLessThanOrEqual(4096);
    }
  });
});
