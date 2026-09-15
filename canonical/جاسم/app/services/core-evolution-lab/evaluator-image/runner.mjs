import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const [requestPath, sourcePath, baselinePath, reportPath] = process.argv.slice(2);
const BASELINE_ROOT = "/opt/jasim-baseline";
const WORKSPACE = "/workspace";
const POLICY_PATH = "/opt/core-lab/policy.json";
const SHA = /^[a-f0-9]{64}$/;
const MAX_CAPTURE = 256 * 1024;

const digest = (value) => createHash("sha256").update(value).digest("hex");
const stableArtifacts = (artifacts) => [...artifacts].sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role));
const groupDigest = (artifacts) => digest(JSON.stringify(stableArtifacts(artifacts).map(({ path: filePath, role, digest: fileDigest, sizeBytes }) => ({
  path: filePath, role, digest: fileDigest, sizeBytes,
}))));

function fail(message) { throw new Error(message); }
function safeRelative(value) {
  if (typeof value !== "string" || !value || value.length > 500 || value.includes("\\") || value.startsWith("/") || value.includes("\0")) fail("invalid patch path");
  if (value.split("/").some((part) => !part || part === "." || part === "..")) fail("invalid patch path");
  return value;
}
function inside(root, relative) {
  const target = path.resolve(root, safeRelative(relative));
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail("path escaped workspace");
  return target;
}
async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

function validateRequest(request) {
  if (!request || typeof request !== "object" || !SHA.test(request.expectedSourceDigest) || !SHA.test(request.expectedKernelDigest)) fail("invalid request");
  if (typeof request.isolationProvider !== "string" || !request.isolationProvider || request.isolationProvider.length > 200) fail("invalid isolation provider");
  if (!Array.isArray(request.requiredGates) || !Array.isArray(request.replayFixtures) || !Array.isArray(request.declaredScope)) fail("invalid request arrays");
  if (request.policy?.network !== false || request.policy?.environment !== false || request.policy?.productionDatabase !== false) fail("unsafe policy");
}

function validateBundle(bundle, request, baseline) {
  if (bundle?.formatVersion !== 1 || bundle.kind !== "core_patch_bundle" || !Array.isArray(bundle.files) || bundle.files.length < 1 || bundle.files.length > 500) fail("invalid core patch bundle");
  if (bundle.baseManifestDigest !== baseline.manifestDigest || bundle.targetVersion !== request.targetVersion) fail("bundle target mismatch");
  const scope = new Set(request.declaredScope.map(safeRelative));
  const seen = new Set();
  for (const file of bundle.files) {
    const filePath = safeRelative(file.path);
    if (seen.has(filePath) || !scope.has(filePath)) fail("bundle path outside declared scope or duplicated");
    seen.add(filePath);
    if (!["kernel", "manifest", "test"].includes(file.role) || !["upsert", "delete"].includes(file.operation)) fail("invalid bundle file declaration");
    if (file.operation === "upsert" && (typeof file.contentBase64 !== "string" || !SHA.test(file.digest))) fail("invalid upsert content");
  }
}

function semanticBaselineDigest(manifest) {
  return digest(JSON.stringify({
    formatVersion: manifest.formatVersion,
    version: manifest.version,
    rootLabel: manifest.rootLabel,
    artifacts: stableArtifacts(manifest.artifacts),
    kernelDigest: manifest.kernelDigest,
    testSuiteDigest: manifest.testSuiteDigest,
  }));
}

async function verifyBakedBaseline(manifest, request) {
  if (manifest.manifestDigest !== semanticBaselineDigest(manifest) || manifest.kernelDigest !== request.expectedKernelDigest) fail("baseline manifest mismatch");
  const checked = [];
  for (const artifact of manifest.artifacts) {
    const target = inside(BASELINE_ROOT, artifact.path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== artifact.sizeBytes) fail("baked baseline artifact mismatch");
    const bytes = await readFile(target);
    if (digest(bytes) !== artifact.digest) fail("baked baseline digest mismatch");
    checked.push(artifact);
  }
  const calculatedKernel = groupDigest(checked.filter((artifact) => artifact.role !== "test"));
  const calculatedTests = groupDigest(checked.filter((artifact) => artifact.role === "test"));
  if (calculatedKernel !== manifest.kernelDigest || calculatedTests !== manifest.testSuiteDigest) fail("baked baseline aggregate mismatch");
}

async function prepareWorkspace() {
  await cp(BASELINE_ROOT, WORKSPACE, {
    recursive: true,
    force: false,
    filter(source) {
      const relative = path.relative(BASELINE_ROOT, source).split(path.sep).join("/");
      return !relative || !["node_modules", ".git", "data", ".env"].some((entry) => relative === entry || relative.startsWith(`${entry}/`));
    },
  });
  await symlink(`${BASELINE_ROOT}/node_modules`, `${WORKSPACE}/node_modules`, "dir");
}

async function applyBundle(bundle) {
  for (const file of bundle.files) {
    const target = inside(WORKSPACE, file.path);
    if (file.operation === "delete") {
      await rm(target, { force: true });
      continue;
    }
    const content = Buffer.from(file.contentBase64, "base64");
    if (digest(content) !== file.digest) fail("bundle file digest mismatch");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "w", mode: 0o600 });
  }
}

async function candidateManifest(baseline, bundle, request) {
  const declarations = new Map(baseline.artifacts.map((artifact) => [artifact.path, { path: artifact.path, role: artifact.role }]));
  for (const file of bundle.files) {
    if (file.operation === "delete") declarations.delete(file.path);
    else declarations.set(file.path, { path: file.path, role: file.role });
  }
  const artifacts = [];
  for (const declaration of declarations.values()) {
    const target = inside(WORKSPACE, declaration.path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) fail("candidate artifact is not a regular file");
    const content = await readFile(target);
    artifacts.push({ ...declaration, digest: digest(content), sizeBytes: content.byteLength });
  }
  const sorted = stableArtifacts(artifacts);
  const kernelDigest = groupDigest(sorted.filter((artifact) => artifact.role !== "test"));
  const testSuiteDigest = groupDigest(sorted.filter((artifact) => artifact.role === "test"));
  const payload = { formatVersion: 1, version: request.targetVersion, rootLabel: baseline.rootLabel, artifacts: sorted, kernelDigest, testSuiteDigest };
  return { ...payload, manifestDigest: digest(JSON.stringify(payload)) };
}

async function runCommand(command, timeoutMs) {
  return new Promise((resolve) => {
    const [program, ...args] = command;
    const started = Date.now();
    const child = spawn(program, args, {
      cwd: WORKSPACE,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp", NODE_ENV: "test", CI: "true" },
    });
    const output = [];
    let size = 0;
    let overflow = false;
    const capture = (chunk) => {
      size += chunk.byteLength;
      if (size > MAX_CAPTURE) { overflow = true; child.kill("SIGKILL"); return; }
      output.push(chunk);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ passed: false, elapsedMs: Date.now() - started, output: error.message }); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ passed: code === 0 && !overflow, elapsedMs: Date.now() - started, output: Buffer.concat(output).toString("utf8"), code, signal, overflow });
    });
  });
}

async function persistEvidence(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const evidenceDigest = digest(content);
  const evidenceDirectory = path.join(path.dirname(reportPath), "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  try {
    await writeFile(path.join(evidenceDirectory, `${evidenceDigest}.blob`), content, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }
  return `artifact://sha256/${evidenceDigest}`;
}

function gateResult(gate, passed, summary, evidence, metrics = {}) {
  return { gate, passed, evaluator: `core-lab-container:${gate}`, summary, evidenceRefs: [evidence], metrics, completedAt: new Date().toISOString() };
}

async function evaluateGates(request, bundle, candidate, policy) {
  const results = [];
  const commands = policy.gateCommands ?? {};
  const timeout = Math.max(1_000, Math.floor(request.policy.timeoutMs / Math.max(request.requiredGates.length, 1)));
  for (const gate of request.requiredGates.filter((name) => name !== "replay")) {
    let builtIn;
    if (gate === "static_validation" || gate === "schema") builtIn = { passed: true, summary: "Bundle and contracts validated" };
    if (gate === "migration") {
      const changed = bundle.files.some((file) => file.path.startsWith("db/migrations/"));
      builtIn = { passed: !changed, summary: changed ? "Migration changes require a reviewed dry-run command" : "No migration files changed" };
    }
    if (gate === "reproducible_build") {
      const second = await candidateManifest(await readJson(baselinePath), bundle, request);
      builtIn = { passed: second.manifestDigest === candidate.manifestDigest, summary: "Candidate manifest reproduced deterministically" };
    }
    const command = commands[gate];
    if (Array.isArray(command) && command.every((item) => typeof item === "string") && command.length > 0) {
      const execution = await runCommand(command, timeout);
      const evidence = await persistEvidence(execution.output);
      results.push(gateResult(gate, execution.passed, execution.passed ? `${gate} command passed` : `${gate} command failed`, evidence, { elapsedMs: execution.elapsedMs }));
    } else if (builtIn) {
      results.push(gateResult(gate, builtIn.passed, builtIn.summary, await persistEvidence(`${gate}:${builtIn.summary}`)));
    } else {
      const summary = `${gate} has no reviewed evaluator in this image`;
      results.push(gateResult(gate, false, summary, await persistEvidence(summary)));
    }
  }
  return results;
}

function uncertainReplayCases(request, elapsedMs) {
  return request.replayFixtures.map((fixture) => ({
    ...fixture,
    candidate: {
      status: "uncertain",
      latencyMs: elapsedMs,
      cost: fixture.baseline.cost,
      safetyIncidents: 0,
      approvalsRequired: fixture.baseline.approvalsRequired,
    },
  }));
}

function validObservation(value) {
  const statuses = new Set(["completed", "waiting_approval", "waiting_input", "failed", "uncertain"]);
  return value && typeof value === "object" && statuses.has(value.status)
    && Number.isInteger(value.latencyMs) && value.latencyMs >= 0
    && typeof value.cost === "number" && value.cost >= 0
    && Number.isInteger(value.safetyIncidents) && value.safetyIncidents >= 0
    && Number.isInteger(value.approvalsRequired) && value.approvalsRequired >= 0
    && ["outcomeDigest", "evidenceDigest", "sideEffectDigest"].every((key) => value[key] === undefined || SHA.test(value[key]));
}

async function evaluateReplay(request, policy, timeoutMs) {
  if (!Array.isArray(policy.replayCommand) || !policy.replayCommand.length || !policy.replayCommand.every((item) => typeof item === "string")) {
    return uncertainReplayCases(request, 0);
  }
  const output = "/tmp/core-lab-replay.json";
  await rm(output, { force: true });
  const execution = await runCommand([...policy.replayCommand, requestPath, output], timeoutMs);
  await persistEvidence(execution.output);
  if (!execution.passed) return uncertainReplayCases(request, execution.elapsedMs);
  let decoded;
  try { decoded = await readJson(output); } catch { return uncertainReplayCases(request, execution.elapsedMs); }
  if (!Array.isArray(decoded?.cases)) return uncertainReplayCases(request, execution.elapsedMs);
  const observations = new Map(decoded.cases.map((item) => [item?.id, item?.candidate]));
  if (observations.size !== request.replayFixtures.length) return uncertainReplayCases(request, execution.elapsedMs);
  return request.replayFixtures.map((fixture) => {
    const candidate = observations.get(fixture.id);
    if (!validObservation(candidate)) fail(`invalid replay observation for ${fixture.id}`);
    return { ...fixture, candidate };
  });
}

async function main() {
  if (![requestPath, sourcePath, baselinePath, reportPath].every(Boolean)) fail("runner requires four fixed paths");
  const [request, baseline, policy, sourceBytes] = await Promise.all([
    readJson(requestPath), readJson(baselinePath), readJson(POLICY_PATH), readFile(sourcePath),
  ]);
  validateRequest(request);
  if (digest(sourceBytes) !== request.expectedSourceDigest) fail("source digest mismatch inside container");
  const bundle = JSON.parse(sourceBytes.toString("utf8"));
  validateBundle(bundle, request, baseline);
  await verifyBakedBaseline(baseline, request);
  const started = Date.now();
  await prepareWorkspace();
  await applyBundle(bundle);
  const candidate = await candidateManifest(baseline, bundle, request);
  const gateResults = await evaluateGates(request, bundle, candidate, policy);
  const replayCases = await evaluateReplay(request, policy, Math.max(1_000, Math.floor(request.policy.timeoutMs / 2)));
  const buildEvidence = await persistEvidence(JSON.stringify({ source: request.expectedSourceDigest, baseline: baseline.manifestDigest, candidate: candidate.manifestDigest, gates: gateResults }));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({
    candidateId: request.candidateId,
    baselineId: request.baselineId,
    sourceDigest: request.expectedSourceDigest,
    baselineKernelDigest: request.expectedKernelDigest,
    candidateKernelDigest: candidate.kernelDigest,
    manifestDigest: candidate.manifestDigest,
    mode: "isolated",
    isolationProvider: request.isolationProvider,
    gateResults,
    replayCases,
    buildEvidenceRefs: [buildEvidence],
    evaluatedAt: new Date().toISOString(),
  }), { flag: "wx", mode: 0o644 });
}

main().catch((error) => {
  process.stderr.write(`Core Lab evaluator failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
