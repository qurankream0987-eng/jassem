import path from "node:path";

export interface CoreEvolutionLabConfig {
  bind: string; port: number; token: string; providerId: string;
  sourceArtifactRoot: string; baselineArtifactRoot: string;
  artifactStore: "filesystem" | "s3"; artifactRoot?: string;
  s3?: { bucket: string; prefix: string; region?: string; endpoint?: string; expectedBucketOwner?: string };
  image: string; dockerBinary: string; workRoot?: string;
  workerId: string; leaseMs: number; pollMs: number;
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value;
}
function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

export function loadCoreEvolutionLabConfig(env: NodeJS.ProcessEnv = process.env): CoreEvolutionLabConfig {
  const bind = env.JASIM_CORE_LAB_BIND?.trim() || "127.0.0.1";
  if (["0.0.0.0", "::"].includes(bind) && env.JASIM_CORE_LAB_ALLOW_PUBLIC_BIND !== "true") throw new Error("Public Core Lab bind requires JASIM_CORE_LAB_ALLOW_PUBLIC_BIND=true and an HTTPS boundary");
  const token = required(env, "JASIM_CORE_LAB_TOKEN");
  if (token.length < 24) throw new Error("JASIM_CORE_LAB_TOKEN must contain at least 24 characters");
  const artifactStore = env.JASIM_CORE_LAB_ARTIFACT_STORE === "s3" ? "s3" : "filesystem";
  const config: CoreEvolutionLabConfig = {
    bind,
    port: integer(env, "JASIM_CORE_LAB_PORT", 4010, 1, 65_535),
    token,
    providerId: env.JASIM_CORE_LAB_PROVIDER_ID?.trim() || "core-lab:docker",
    sourceArtifactRoot: path.resolve(required(env, "JASIM_CORE_LAB_SOURCE_ARTIFACT_ROOT")),
    baselineArtifactRoot: path.resolve(required(env, "JASIM_CORE_LAB_BASELINE_ARTIFACT_ROOT")),
    artifactStore,
    image: required(env, "JASIM_CORE_LAB_IMAGE"),
    dockerBinary: env.JASIM_CORE_LAB_DOCKER_BIN?.trim() || "docker",
    workRoot: env.JASIM_CORE_LAB_WORK_ROOT ? path.resolve(env.JASIM_CORE_LAB_WORK_ROOT) : undefined,
    workerId: env.JASIM_CORE_LAB_WORKER_ID?.trim() || `core-lab-worker-${process.pid}`,
    leaseMs: integer(env, "JASIM_CORE_LAB_LEASE_MS", 60_000, 5_000, 600_000),
    pollMs: integer(env, "JASIM_CORE_LAB_POLL_MS", 1_000, 100, 60_000),
  };
  if (artifactStore === "filesystem") config.artifactRoot = path.resolve(required(env, "JASIM_CORE_LAB_ARTIFACT_ROOT"));
  else config.s3 = {
    bucket: required(env, "JASIM_CORE_LAB_S3_BUCKET"),
    prefix: env.JASIM_CORE_LAB_S3_PREFIX?.trim() || "jasim-core-lab",
    region: env.AWS_REGION?.trim(), endpoint: env.JASIM_CORE_LAB_S3_ENDPOINT?.trim(),
    expectedBucketOwner: env.JASIM_CORE_LAB_S3_EXPECTED_OWNER?.trim(),
  };
  return config;
}

