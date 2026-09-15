import { z } from "zod";

export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ImmutableArtifactUriSchema = z.string().regex(/^artifact:\/\/sha256\/[a-f0-9]{64}$/);

export const ImmutableArtifactSchema = z.object({
  uri: ImmutableArtifactUriSchema,
  digest: Sha256DigestSchema,
  sizeBytes: z.number().int().nonnegative(),
  mediaType: z.string().min(1).max(200).default("application/octet-stream"),
  createdAt: z.string().datetime(),
});
export type ImmutableArtifact = z.infer<typeof ImmutableArtifactSchema>;

export function artifactUri(digest: string): string {
  return `artifact://sha256/${Sha256DigestSchema.parse(digest)}`;
}

export function digestFromArtifactUri(uri: string): string {
  const parsed = ImmutableArtifactUriSchema.parse(uri);
  return parsed.slice("artifact://sha256/".length);
}
