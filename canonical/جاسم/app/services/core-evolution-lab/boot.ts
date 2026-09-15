import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { FilesystemCoreLabArtifactResolver } from "./artifact-resolver";
import { loadCoreEvolutionLabConfig } from "./config";
import { DockerCoreLabRunner } from "./docker-runner";
import { CoreEvolutionLabEvaluationService } from "./evaluation-service";
import { createCoreEvolutionLabHandler } from "./http-app";
import { CoreEvolutionLabJobService } from "./job-service";
import { DrizzleDurableJobRepository } from "../../api/core/drizzle-durable-job-repository";
import { DurableJobQueue } from "../../api/core/durable-job-queue";
import { DurableJobWorker } from "../../api/core/durable-job-worker";
import { FilesystemImmutableArtifactStore, type ImmutableArtifactStore } from "../../api/core/immutable-artifact-store";
import { S3ImmutableArtifactStore } from "../../api/core/s3-immutable-artifact-store";
import { CORE_EVOLUTION_EVALUATION_JOB_KIND } from "@contracts/core-evolution-job";

const MAX_HTTP_BODY = 4_194_304;
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.byteLength; if (size > MAX_HTTP_BODY) throw new Error("request too large"); chunks.push(bytes); }
  return Buffer.concat(chunks);
}
async function send(response: ServerResponse, webResponse: Response): Promise<void> {
  response.statusCode = webResponse.status; webResponse.headers.forEach((value, name) => response.setHeader(name, value)); response.end(Buffer.from(await webResponse.arrayBuffer()));
}

const config = loadCoreEvolutionLabConfig();
const artifacts: ImmutableArtifactStore = config.artifactStore === "s3"
  ? new S3ImmutableArtifactStore({ bucket: config.s3!.bucket, prefix: config.s3!.prefix, expectedBucketOwner: config.s3!.expectedBucketOwner, clientConfig: { region: config.s3!.region, endpoint: config.s3!.endpoint } })
  : new FilesystemImmutableArtifactStore(config.artifactRoot!);
const resolver = new FilesystemCoreLabArtifactResolver({ sourceRoot: config.sourceArtifactRoot, baselineRoot: config.baselineArtifactRoot });
const runner = new DockerCoreLabRunner({ image: config.image, dockerBinary: config.dockerBinary, workRoot: config.workRoot, evidenceStore: artifacts });
const evaluator = new CoreEvolutionLabEvaluationService(config.providerId, resolver, runner);
const queue = new DurableJobQueue({ repository: new DrizzleDurableJobRepository(), defaultLeaseMs: config.leaseMs });
const service = new CoreEvolutionLabJobService(queue, artifacts, evaluator);
const worker = new DurableJobWorker({ id: config.workerId, queue, artifacts, handlers: new Map([[CORE_EVOLUTION_EVALUATION_JOB_KIND, service.handler]]), leaseMs: config.leaseMs, pollMs: config.pollMs });
const handler = createCoreEvolutionLabHandler({ service, token: config.token, maxRequestBytes: MAX_HTTP_BODY });

const server = createServer(async (request, response) => {
  try {
    const body = ["GET", "HEAD"].includes(request.method ?? "GET") ? undefined : await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) { if (Array.isArray(value)) value.forEach((item) => headers.append(name, item)); else if (value !== undefined) headers.set(name, value); }
    await send(response, await handler(new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, { method: request.method, headers, body })));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "request too large";
    await send(response, Response.json({ error: tooLarge ? "request too large" : "request rejected" }, { status: tooLarge ? 413 : 400 }));
  }
});
server.requestTimeout = 30_000; server.headersTimeout = 10_000;
server.listen(config.port, config.bind, () => console.log(`JASIM Core Evolution Lab listening on ${config.bind}:${config.port}`));
void worker.run().catch((error) => { console.error("[JASIM Core Lab] durable worker stopped", error); process.exitCode = 1; server.close(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { worker.stop(); server.close(); });

