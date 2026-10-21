// Wire contracts for the Issues plugin: the RPC methods app.tsx calls, and the one
// method server.ts calls on its own host entry. Both sides validate against these
// schemas, so a payload that does not match never reaches a handler.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const projectId = z.string().min(1).max(200);
const issueNumber = z.number().int().positive();
const labelName = z.string().min(1).max(200);

const labelSchema = z.object({ name: z.string(), color: z.string() });

const linkedPullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
});

const issueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  html_url: z.string(),
  labels: z.array(labelSchema),
  parent_issue_url: z.string().nullable().optional(),
  sub_issues_summary: z
    .object({
      total: z.number(),
      completed: z.number(),
      percent_completed: z.number(),
    })
    .nullable()
    .optional(),
  linked_pull_requests: z.array(linkedPullRequestSchema).optional(),
});

const repoSchema = z.object({ owner: z.string(), name: z.string() });

const threadLinkSchema = z.object({
  threadId: z.string(),
  title: z.string().nullable(),
});

const ticketDraftSchema = z.object({
  title: z.string().max(1_000),
  body: z.string().max(100_000),
});

export const rpcContract = defineRpcContract({
  issues_get_board: {
    input: z.object({ projectId }).strict(),
    output: z.object({
      repo: repoSchema,
      issues: z.array(issueSchema),
      labels: z.array(labelSchema),
      values: z.record(z.string(), z.number()),
      columnLabels: z.array(z.string()),
      threadLinks: z.record(z.string(), threadLinkSchema),
    }),
  },
  issues_set_value: {
    input: z
      .object({
        projectId,
        issueNumber,
        value: z.number().int().min(1).max(10).nullable(),
      })
      .strict(),
    output: z.null(),
  },
  issues_get_config: {
    input: z.object({ projectId }).strict(),
    output: z.object({
      columnLabels: z.array(z.string()),
      labels: z.array(
        z.object({ name: z.string(), color: z.string(), used: z.boolean() }),
      ),
    }),
  },
  issues_set_column_labels: {
    input: z
      .object({ projectId, labels: z.array(labelName).max(100) })
      .strict(),
    output: z.null(),
  },
  issues_create_issue: {
    input: z
      .object({
        projectId,
        title: z.string().trim().min(1).max(256),
        body: z.string().max(65_536),
        labels: z.array(labelName).max(100),
      })
      .strict(),
    output: z.object({ issue: issueSchema }),
  },
  issues_edit_issue: {
    input: z
      .object({
        projectId,
        number: issueNumber,
        title: z.string().trim().min(1).max(256).optional(),
        body: z.string().max(65_536).optional(),
        state: z.enum(["open", "closed"]).optional(),
        addLabels: z.array(labelName).max(100).optional(),
        removeLabels: z.array(labelName).max(100).optional(),
      })
      .strict(),
    output: z.null(),
  },
  issues_update_label_color: {
    input: z
      .object({ projectId, name: labelName, color: z.string().max(16) })
      .strict(),
    output: z.null(),
  },
  issues_refine_ticket: {
    input: z
      .object({
        projectId,
        repo: z.string().max(200),
        repoLabels: z.array(z.string().max(200)).max(500),
        text: z.string().max(20_000),
        draft: ticketDraftSchema.nullable(),
        feedback: z.string().max(20_000),
      })
      .strict(),
    output: ticketDraftSchema,
  },
  issues_ai_status: {
    input: z.null(),
    output: z.object({ ready: z.boolean() }),
  },
  issues_start_thread: {
    input: z
      .object({
        projectId,
        issueNumber,
        title: z.string().max(1_000),
      })
      .strict(),
    output: z.object({ threadId: z.string() }),
  },
  issues_set_repo: {
    input: z
      .object({ projectId, repo: z.string().max(200).nullable() })
      .strict(),
    output: z.null(),
  },
});

export type RpcContract = typeof rpcContract;

// The host entry runs on the server's own machine, where `gh` keeps its login.
export const hostContract = defineRpcContract({
  ghAuthToken: {
    input: z.null(),
    output: z.object({
      token: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
});
