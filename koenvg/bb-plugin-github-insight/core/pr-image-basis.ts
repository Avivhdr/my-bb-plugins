import { z } from "zod";
import { imageShaSchema } from "./image-content";

export const imageRepoSchema = z.object({
  owner: z.string().regex(/^[a-z0-9-]+$/i),
  repo: z
    .string()
    .regex(/^[a-z0-9_.-]+$/i)
    .refine((repo) => repo !== "." && repo !== ".."),
});
export const prImageRefsSchema = z.object({
  baseRepo: imageRepoSchema,
  headRepo: imageRepoSchema,
  baseSha: imageShaSchema,
  headSha: imageShaSchema,
});
export const prImageBasisSchema = prImageRefsSchema.extend({
  mergeBaseSha: imageShaSchema,
  hostId: z.string().min(1),
});
export type PrImageRefs = z.infer<typeof prImageRefsSchema>;
export type PrImageBasis = z.infer<typeof prImageBasisSchema>;
export function imageBasisKey(basis: PrImageBasis): string {
  return JSON.stringify([
    basis.hostId,
    basis.baseRepo.owner,
    basis.baseRepo.repo,
    basis.headRepo.owner,
    basis.headRepo.repo,
    basis.baseSha,
    basis.headSha,
    basis.mergeBaseSha,
  ]);
}
export function parseImageRefs(value: unknown): PrImageRefs | null {
  const repo = z.object({ owner: z.object({ login: z.string() }), name: z.string() });
  const result = z
    .object({
      data: z.object({
        repository: z.object({
          pullRequest: z.object({
            baseRefOid: imageShaSchema,
            headRefOid: imageShaSchema,
            baseRepository: repo,
            headRepository: repo,
          }),
        }),
      }),
    })
    .safeParse(value);
  if (!result.success) return null;
  const pr = result.data.data.repository.pullRequest;
  const refs = prImageRefsSchema.safeParse({
    baseSha: pr.baseRefOid,
    headSha: pr.headRefOid,
    baseRepo: { owner: pr.baseRepository.owner.login, repo: pr.baseRepository.name },
    headRepo: { owner: pr.headRepository.owner.login, repo: pr.headRepository.name },
  });
  return refs.success ? refs.data : null;
}
