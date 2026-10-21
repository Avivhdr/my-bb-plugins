import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const rootPath = z.string().min(1).max(4096);

export const hostContract = defineRpcContract({
  resolve_root: {
    input: z.object({ rootPath }).strict(),
    output: z.object({ rootPath }).strict(),
  },
  find_by_name: {
    input: z
      .object({
        rootPath,
        name: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^/\\]+$/),
      })
      .strict(),
    output: z.object({ paths: z.array(z.string().max(4096)).max(10) }).strict(),
  },
});
