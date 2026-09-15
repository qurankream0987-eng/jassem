/** Docker runner with a fixed command surface and fail-closed isolation policy. */

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { CoreLabEvaluationReportSchema } from "@contracts/core-evolution";
import type { CoreLabContainerInput, CoreLabContainerRunner } from "./evaluation-service";
import type { ImmutableArtifactStore } from "../../api/core/immutable-artifact-store";

const DIGEST_PINNED_IMAGE = /^(?:[a-z0-9][a-z0-9._\/-]*(?::[a-zA-Z0-9._-]+)?@)?sha256:[a-f0-9]{64}$/;

export interface CommandResult { exitCode: number; stdout: string; stderr: string }
export interface CommandRunOptions { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }
export interface DockerCommandExecutor {
  run(command: string, args: string[], options: CommandRunOptions): Promise<CommandResult>;
}

export interface DockerCoreLabRunnerOptions {
  image: string;
  dockerBinary?: string;
  workRoot?: string;
  evidenceRoot?: string;
  evidenceStore?: ImmutableArtifactStore;
  containerUser?: string;
  cpuLimit?: number;
  pidsLimit?: number;
  executor?: DockerCommandExecutor;
}

export interface DockerJobPaths {
  source: string;
  baseline: string;
  request: string;
  outputDirectory: string;
}

function safeMount(pathValue: string): string {
  if (/[\r\n,]/.test(pathValue)) throw new Error("Docker bind mount path contains unsupported characters");
  return pathValue;
}

export function buildDockerRunArguments(
  input: CoreLabContainerInput,
  paths: DockerJobPaths,
  containerName: string,
  options: Required<Pick<DockerCoreLabRunnerOptions, "image" | "containerUser" | "cpuLimit" | "pidsLimit">>,
): string[] {
  const memory = `${input.request.policy.maxMemoryMb}m`;
  const workspaceMemory = `${Math.min(Math.max(Math.floor(input.request.policy.maxMemoryMb / 2), 64), 1_024)}m`;
  return [
    "run", "--rm", "--pull", "never", "--name", containerName,
    "--network", "none", "--ipc", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(options.pidsLimit), "--memory", memory, "--memory-swap", memory,
    "--cpus", String(options.cpuLimit), "--user", options.containerUser,
    "--ulimit", `nproc=${options.pidsLimit}:${options.pidsLimit}`,
    "--ulimit", "nofile=1024:1024", "--stop-timeout", "5", "--log-driver", "none",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--tmpfs", `/workspace:rw,nosuid,nodev,size=${workspaceMemory}`,
    "--mount", `type=bind,src=${safeMount(paths.source)},dst=/lab/input/source.blob,readonly`,
    "--mount", `type=bind,src=${safeMount(paths.baseline)},dst=/lab/input/baseline.json,readonly`,
    "--mount", `type=bind,src=${safeMount(paths.request)},dst=/lab/input/request.json,readonly`,
    "--mount", `type=bind,src=${safeMount(paths.outputDirectory)},dst=/lab/output`,
    options.image,
    "/lab/input/request.json", "/lab/input/source.blob", "/lab/input/baseline.json", "/lab/output/report.json",
  ];
}

export class SpawnDockerCommandExecutor implements DockerCommandExecutor {
  async run(command: string, args: string[], options: CommandRunOptions): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          DOCKER_HOST: process.env.DOCKER_HOST,
          DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
        },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const abort = () => fail(new Error("Docker evaluation was cancelled"));
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        child.kill("SIGKILL");
        reject(error);
      };
      const capture = (target: Buffer[], chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > options.maxOutputBytes) return fail(new Error("Docker command output exceeded its limit"));
        target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
      child.once("error", (error) => fail(new Error(`Docker could not be started: ${error.message}`)));
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        resolve({ exitCode: code ?? -1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      });
      const timer = setTimeout(() => fail(new Error("Docker evaluation timed out")), options.timeoutMs);
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

export class DockerCoreLabRunner implements CoreLabContainerRunner {
  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly workRoot: string;
  private readonly evidenceRoot?: string;
  private readonly evidenceStore?: ImmutableArtifactStore;
  private readonly containerUser: string;
  private readonly cpuLimit: number;
  private readonly pidsLimit: number;
  private readonly executor: DockerCommandExecutor;

  constructor(options: DockerCoreLabRunnerOptions) {
    if (!DIGEST_PINNED_IMAGE.test(options.image)) throw new Error("Core Lab image must be pinned by sha256 digest");
    this.image = options.image;
    this.dockerBinary = options.dockerBinary ?? "docker";
    this.workRoot = path.resolve(options.workRoot ?? tmpdir());
    if (!options.evidenceRoot && !options.evidenceStore) throw new Error("Core Lab evidence storage is required");
    this.evidenceRoot = options.evidenceRoot ? path.resolve(options.evidenceRoot) : undefined;
    this.evidenceStore = options.evidenceStore;
    this.containerUser = options.containerUser ?? "65532:65532";
    this.cpuLimit = Math.min(Math.max(options.cpuLimit ?? 1, 0.1), 4);
    this.pidsLimit = Math.min(Math.max(options.pidsLimit ?? 256, 16), 1_024);
    this.executor = options.executor ?? new SpawnDockerCommandExecutor();
  }

  async run(input: CoreLabContainerInput, signal?: AbortSignal): Promise<unknown> {
    await mkdir(this.workRoot, { recursive: true });
    const jobRoot = await mkdtemp(path.join(this.workRoot, "jasim-core-lab-"));
    const outputDirectory = path.join(jobRoot, "output");
    const requestPath = path.join(jobRoot, "request.json");
    const reportPath = path.join(outputDirectory, "report.json");
    const containerName = `jasim-core-lab-${randomUUID()}`;
    await mkdir(outputDirectory);
    await chmod(outputDirectory, 0o733);
    await writeFile(requestPath, JSON.stringify({ ...input.request, isolationProvider: input.isolationProvider }), {
      encoding: "utf8", flag: "wx", mode: 0o400,
    });
    const args = buildDockerRunArguments(input, {
      source: input.artifacts.source.path,
      baseline: input.artifacts.baseline.path,
      request: requestPath,
      outputDirectory,
    }, containerName, {
      image: this.image,
      containerUser: this.containerUser,
      cpuLimit: this.cpuLimit,
      pidsLimit: this.pidsLimit,
    });
    try {
      const result = await this.executor.run(this.dockerBinary, args, {
        timeoutMs: input.request.policy.timeoutMs,
        maxOutputBytes: Math.min(input.request.policy.maxOutputBytes, 1_048_576),
        signal,
      });
      if (result.exitCode !== 0) throw new Error(`Isolated evaluator failed with exit code ${result.exitCode}`);
      const storedEvidence = await this.persistEvidence(outputDirectory, input.request.policy.maxOutputBytes);
      const report = CoreLabEvaluationReportSchema.parse(
        await this.readReport(outputDirectory, reportPath, input.request.policy.maxOutputBytes),
      );
      const evidenceRefs = [
        ...report.buildEvidenceRefs,
        ...report.gateResults.flatMap((gate) => gate.evidenceRefs),
      ];
      for (const ref of evidenceRefs) {
        const match = /^artifact:\/\/sha256\/([a-f0-9]{64})$/.exec(ref);
        if (!match || !storedEvidence.has(match[1])) throw new Error("Container report references missing build evidence");
      }
      return report;
    } catch (error) {
      await this.executor.run(this.dockerBinary, ["rm", "-f", containerName], {
        timeoutMs: 10_000,
        maxOutputBytes: 64 * 1024,
      }).catch(() => undefined);
      throw error;
    } finally {
      await rm(jobRoot, { recursive: true, force: true });
    }
  }

  private async persistEvidence(outputDirectory: string, reportLimit: number): Promise<Set<string>> {
    const sourceDirectory = path.join(outputDirectory, "evidence");
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    if (entries.length < 1 || entries.length > 1_000) throw new Error("Container emitted an invalid evidence set");
    if (this.evidenceRoot) await mkdir(this.evidenceRoot, { recursive: true });
    const stored = new Set<string>();
    let totalBytes = 0;
    const totalLimit = Math.min(reportLimit * 4, 16_777_216);
    for (const entry of entries) {
      const match = /^([a-f0-9]{64})\.blob$/.exec(entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !match) throw new Error("Container emitted an invalid evidence artifact");
      const source = path.join(sourceDirectory, entry.name);
      const info = await lstat(source);
      totalBytes += info.size;
      if (totalBytes > totalLimit) throw new Error("Container evidence exceeded its total size limit");
      const content = await readFile(source);
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== match[1]) throw new Error("Container evidence digest mismatch");
      if (this.evidenceStore) {
        const artifact = await this.evidenceStore.put(content, { mediaType: "application/vnd.jasim.core-evolution-evidence" });
        if (artifact.digest !== actual) throw new Error("Evidence store returned a conflicting digest");
      } else if (this.evidenceRoot) {
        const targetDirectory = path.join(this.evidenceRoot, actual.slice(0, 2));
        const target = path.join(targetDirectory, `${actual}.blob`);
        await mkdir(targetDirectory, { recursive: true });
        try {
          await writeFile(target, content, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
          const existing = await readFile(target);
          if (createHash("sha256").update(existing).digest("hex") !== actual) throw new Error("Stored evidence conflicts with its digest");
        }
      }
      stored.add(actual);
    }
    return stored;
  }

  private async readReport(outputDirectory: string, reportPath: string, maxBytes: number): Promise<unknown> {
    const info = await lstat(reportPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Container report must be a regular file");
    if (info.size > maxBytes) throw new Error("Container report exceeded its size limit");
    const resolvedOutput = await realpath(outputDirectory);
    const resolvedReport = await realpath(reportPath);
    const relative = path.relative(resolvedOutput, resolvedReport);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Container report escaped its output directory");
    const raw = await readFile(resolvedReport, "utf8");
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("Container report exceeded its size limit");
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error("Container report is not valid JSON");
    }
  }
}
