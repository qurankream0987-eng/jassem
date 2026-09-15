# JASIM Generative Runtime — Foundation

This document defines the first implemented boundary for JASIM's evolving DNA.

## Canonical runtime

The TypeScript runtime in `api/core` is the canonical execution path. Ideas from
`jasim-unified`, the Python DNA experiments, older application versions and
research documents are inputs to the design; they are not parallel runtimes.

## Invariant

JASIM may accumulate knowledge, workflows, capabilities, policies, UI patterns
and world definitions without rewriting a serving kernel. A core improvement is
also allowed, but it must enter as a `core_patch` candidate and pass through a
separate Core Evolution Lab before a versioned rollout.

## Implemented in this foundation

1. `contracts/generative-dna.ts` defines versioned genes, candidates, evidence,
   fitness, sources, genome snapshots and assimilation artifacts.
2. `api/core/assimilation-engine.ts` accepts content as untrusted data, hashes
   it, detects basic structure and produces a candidate. It never imports or
   executes uploaded code.
3. `api/core/dna-version-registry.ts` enforces evaluation, approval, canary,
   activation, evidence-based fitness and immutable genome snapshots.
4. `api/core/runtime.ts` exposes the registry and assimilation engine as shared
   runtime components.

## Safety boundary

- Embedded instructions in a document are content, not runtime commands.
- A capability cannot activate without a reviewed executor reference.
- A candidate cannot activate without a passing evaluation and human approval.
- Canary versions are excluded from active genome snapshots until promoted.
- Core patches cannot be activated through the normal DNA registry.
- Evolution fitness is derived from execution evidence, not random mutation.

## Phase 2: durable DNA and review API

The runtime now persists candidates, immutable versions, genome snapshots and
execution evidence through `DrizzleDNARepository`. `GenerativeDNAService`
hydrates the in-memory registry on startup and writes every state transition to
the database.

The `dna` tRPC router exposes these review-gated operations:

- `dna.ingest`
- `dna.listCandidates` / `dna.getCandidate`
- `dna.reviseExecutor`
- `dna.evaluate`
- `dna.approve` / `dna.reject`
- `dna.activate` / `dna.promoteCanary`
- `dna.recordEvidence`
- `dna.snapshot`
- `dna.resolve`
- `dna.evaluatePackage`
- `dna.attestPackage`

Candidate review and lifecycle mutations require an `admin` or `system` role.
Ingestion requires authentication. The Generative Runtime resolves active genes
for each goal and only binds capability genes to executors that already exist
in the canonical `CapabilityRegistry`.

Run `db/migrations/0001_generative_dna_foundation.sql` before enabling durable
DNA in an existing database.

## Phase 3: capability package safety

Assimilated source is now stored by SHA-256 content address through
`DNAArtifactStore`. A capability candidate can be converted to an immutable
manifest containing its file digests, runtime, contracts, permissions,
dependencies, publisher, license and provenance.

`StaticCapabilityPackageEvaluator` checks integrity, missing contracts,
undeclared network/filesystem/database/payment access, embedded credentials,
dynamic evaluation and process spawning. It never executes the source and
therefore always sets `eligibleForExecutionRelease` to `false`.

`CapabilityPackageSigner` uses Ed25519 and supports two distinct scopes:

- `source_attestation`: confirms the exact statically evaluated source.
- `execution_release`: requires a passing isolated evaluation that actually ran
  the contract tests. The static evaluator cannot produce this authorization.

At this stage the API exposed source attestation only. Phase 13 below adds the
separate, stricter execution-release route.

## Phase 4: goal-generated runtime

`DynamicRuntimeComposer` is now the canonical compatibility-free path for a
new goal. It does not select a domain application, agent class or TSX screen.
It derives a temporary operational graph from generic DNA primitives such as
`UNDERSTAND`, `SEARCH`, `RETRIEVE`, `MATCH`, `CONFIRM`, `BUY`, `DELEGATE`,
`TRACK` and `VERIFY`.

For every request it generates:

- an ephemeral `WorldDNA` with only the entities needed by the goal;
- an acyclic `ExecutionPlan` with explicit dependencies and risk metadata;
- task-scoped agent specifications that are composed at execution time and
  disposed when the task reaches a terminal or approval boundary;
- generic `BubbleSchema` contracts (`search`, `map`, `confirmation`,
  `progress`) rendered by the existing schema renderer;
- bindings to relevant active DNA versions, never directly to uploaded code.

The main `jasim.sendMessage` and `jasim.sendMessageStream` paths now invoke this
runtime. The main mutation persists the generated world, plan, composition
identifier and UI schemas with the task, while the subscription streams the
same generated plan and schemas.
An approval-required step is a hard execution boundary: confirmation is
returned to the client and neither the purchase nor dependent fulfillment
steps execute before an explicit resume.

The Arabic acceptance case
`أريد طعام من مطعم فلاني وشوف سائق قريب يوصله لي` is covered without
`FoodAgent`, `FleetAgent`, `Food.tsx` or `Fleet.tsx`. The same composer is also
tested with a different resource to ensure it is operation-driven rather than
food-specific.

Generation does not create external access by itself. Actual restaurant
inventory, payment and nearby-provider execution still require reviewed,
authenticated connectors registered as capabilities.

## Phase 5: generative worlds, participation and bubbles

The runtime no longer models participation as a stored catalogue of membership
types. `WorldDNA.participants` contains goal-generated, free-form roles together
with their capabilities, policies and provenance. A new relationship can
therefore be represented as identity + relation + capability + policy without
adding a domain enum or application class.

World lifetime is structural rather than commercial:

- `ephemeral` is a goal-scoped world, such as evaluating and selling one
  personal watch from supplied evidence;
- `persistent` is a reusable space;
- `evolving` is a reusable world expected to change through conversation, such
  as a clothing shop, a research community or a family archive.

`GenerativeBubbleCompiler` now compiles semantic `WorldDNA.ui` descriptors into
runtime bubbles. It only understands generic visual primitives. Titles, fields,
data sources, actions, entity targets, workflow bindings and approval rules all
come from the generated world. It has no watch, clothing, food, vehicle or
marketplace component.

Direct exchange is also generated independently from persistent platforms. For
`أريد بيع ساعة والدي، سأرسل صورة وأريد تقييم السعر وإيجاد المهتمين`, the runtime
composes evidence understanding, comparable research, appraisal, presentation,
publication approval, listing, counterparty matching, negotiation, final
approval and sale. The subject entity and bubbles are generated for this goal;
no watch application is selected or created.

The same persistent generator is covered by both a clothing-shop world and a
non-commercial shared research community. This verifies that “platform” means
an evolving world inside JASIM, not a synonym for a sales marketplace.

## Phase 6: durable execution and resumable approval

Generated plans now run through `GeneratedPlanExecutor`. Execution is no longer
an in-memory loop that forgets its position at the first confirmation. Every
task stores a versioned checkpoint containing completed steps, resolved results,
authorized steps and an invocation ledger.

Each invocation receives a deterministic idempotency key derived from the task,
plan, step, capability and resolved inputs. Successful invocations are reused on
resume. If the process stops while an irreversible side effect is in progress,
the runtime fails closed and asks for reconciliation instead of guessing and
possibly publishing, charging or selling twice.

Approval records now use the canonical `approvals` table. A confirmation grants
a narrow scope: for example, the first watch-sale confirmation authorizes the
publication step but not the later sale commitment. The final confirmation has
its own scope. Decisions are owner-checked, expire after 30 minutes, and resume
the exact saved plan. Rejection terminates the execution without running its
external effects.

The execution port is deliberately small and domain-free. It resolves generated
capability names through the reviewed `CapabilityRegistry`; approval metadata is
also understood by the security engine. Uploaded code still cannot become an
executor through this path without the DNA review and release process.

User attachments are now added to the generated subject and passed to the
vision step. A watch photo is therefore runtime evidence, not merely message
metadata.

## Phase 7: capability-based connector discovery

`RuntimeConnectorRegistry` selects integrations from declared capability,
scope, permissions, trust, health, priority, latency, cost and effect. It never
selects by commerce domain or a fixed application name. A connector can be
added later for any new relationship or provider without changing the generated
world model.

The first registered routes are:

- reviewed public evidence search;
- reviewed external image analysis for explicitly supplied evidence;
- system-trusted discovery of discoverable entities and intent signals inside
  JASIM;
- approval-gated publication of a generated offer inside JASIM;
- approval-gated creation of an internal exchange commitment.

Search can federate across `jasim_internal` and `public_web`, normalize both
result shapes and preserve connector provenance. Internal discovery uses
free-form entity types, attributes, capabilities, availability and reputation;
it does not require stored membership categories.

Privacy and truthfulness fail closed. A connector that sends user data outside
JASIM is ineligible without explicit goal context allowing that transfer. A
write connector is ineligible without an approval token. Capabilities that
require real-world connectors (`VISION`, `SEARCH`, `LIST`, `BUY`, `SELL`,
`DELEGATE`, `TRACK`, and `EXECUTE`) cannot fall back to a simulated LLM result when no eligible
connector exists. Generic `EXECUTE` is also blocked in this path unless a
reviewed connector explicitly advertises it, so generated plans cannot route
around the connector boundary through the legacy arbitrary HTTP tool.

The internal commitment connector records agreed terms but explicitly returns
`paymentTransferred: false`. It is not represented as a completed payment or
external legal transfer.

## Phase 8: reviewed external action runtime

External execution is now declarative rather than arbitrary HTTP. A connector
definition must be marked `approved`, bind exactly one capability to one
reviewed operation, use a clean HTTPS origin, explicitly list every path,
query and body field, and declare its effect. Runtime input cannot replace the
origin, authentication, headers or path template.

Secrets are represented only by references such as
`env:JASIM_PARTNER_PAYMENT_TOKEN`. They are resolved immediately before an
invocation and are never stored in the connector manifest or returned in an
error. Authentication-looking static headers are rejected. External
definitions are loaded from `JASIM_EXTERNAL_CONNECTORS_JSON` only when the
deployment operator supplies them; no provider is falsely advertised when it
has not been configured.

Financial, dispatch and tracking operations have separate protocols:

- payment accepts integer minor units, ISO currency, tokenized methods and
  provider references; it does not accept raw card data;
- dispatch requires a scoped user approval, deterministic idempotency key,
  pickup, drop-off and an assignment reference;
- tracking is read-only and uses the provider assignment reference.

The HTTP boundary blocks private/local origins, cross-origin redirects,
unreviewed fields, oversized responses and unexpected response types. Provider
errors do not expose response bodies. Side-effecting calls carry the generated
plan's idempotency key and are never automatically failed over after an
ambiguous result.

Connector health is runtime state, not a static claim. Consecutive transport or
provider failures degrade a connector and then open its circuit. Discovery
excludes an open circuit until cooldown, after which a degraded probe can
restore health. User validation and approval errors do not poison provider
health.

Inside JASIM, the generic acquisition path is now complete enough to express
the restaurant-without-delivery case without food or fleet code. It creates an
approved acquisition commitment, assigns the selected free-form fulfillment
participant, persists that assignment idempotently and exposes it through the
generic tracking connector. Both the assignment and any later external
dispatch remain approval-gated; neither implies that payment was transferred.

## Phase 9: durable external reconciliation and first provider adapters

Every generated side effect now enters `external_action_ledger` before the
provider request is sent. The ledger is keyed by connector and deterministic
idempotency key, stores only a digest plus connector-selected reconciliation
fields, and never stores payment tokens, API keys or full delivery contact
data. Reusing an idempotency key with different inputs fails closed.

Transport loss, timeout, a provider 5xx response or an unreadable success
response no longer becomes a retryable failure. The invocation and ledger move
to `uncertain`. A second execution cannot repeat it. `ExternalActionReconciler`
uses the connector's read probe to classify the original action as confirmed
success, confirmed failure, still pending or not found. Probes use exponential
backoff and eventually require human review; they never replay the original
financial or dispatch effect.

The production reliability worker runs due reconciliation without overlapping
itself and probes configured connector health on a slower interval. Static
manifests still describe expected health, while discovery uses measured runtime
health and circuit state.

The first opt-in provider adapters are:

- Moyasar tokenized authorization/capture/refund. Authorization maps JASIM's
  deterministic key to Moyasar `given_id`, sends money in minor units, requires
  an HTTPS callback, and reconciles by fetching that same payment ID. Raw card
  details are not accepted.
- Shipday dispatch. It maps a generic pickup, drop-off, recipient and item set
  to a provider order with a deterministic JASIM order number, then reconciles
  and tracks by that number. A separate read-only tracking connector prevents
  delivery status reads from being classified as dispatch side effects.

Both adapters remain absent from discovery unless their `env:JASIM_*` secret
reference is configured. Dispatch provenance is preserved, so a task sent to
Shipday continues through the Shipday tracking connector instead of falling
back to JASIM-internal tracking.

## Phase 10: generated input pauses and external-action review

A connector can now describe only the values missing for its current operation.
The generated-plan executor checks those requirements before it writes an
invocation or begins an external action. Missing values therefore do not become
failed attempts and can never create a payment or dispatch record.

The executor persists a `waiting_input` checkpoint and produces a generic form
bubble bound to one task, plan, step, capability and connector. Submitting the
request validates only the declared paths, merges them into that same step and
resumes the saved DAG. The runtime does not need a Food, Fleet, Payment or Shop
screen to collect those values.

Sensitive declared paths are removed from task JSON and stored through an
AES-256-GCM vault derived from the deployment `APP_SECRET`. The checkpoint keeps
only an opaque reference. Sensitive values are also redacted if a connector
accidentally echoes one in its result, and the encrypted value is removed when
the plan completes. Payment bubbles explicitly accept only a provider-generated
token, never raw card details.

User-owned external actions now have a schema-driven review bubble. It shows
`uncertain` and `manual_review` states and exposes a reconciliation-only action.
That action performs the provider's read probe and cannot replay the original
payment, publication or dispatch. Ownership is enforced before the probe.

## Phase 11: authenticated and replay-resistant provider webhooks

Inbound provider updates now enter through dedicated Moyasar and Shipday
routes. Authentication happens against the raw UTF-8 body before JSON parsing,
payloads are capped at 256 KiB, secrets remain environment references, and
token/signature comparisons use constant-time digests.

Shipday uses its documented `token` header. Moyasar remains fail-closed until a
deployment explicitly configures both the verified header name and either
`header_token` or `hmac_sha256` mode. JASIM does not infer an undocumented
signature format from the presence of Moyasar's shared secret setting.

Every accepted notification is normalized into a provider-independent event
and claimed in `external_webhook_events` using a provider/event unique key plus
payload digest. Exact redelivery is idempotent. Reusing the same provider event
key with changed content is rejected. An event can update only an already-open
ledger action whose deterministic reconciliation reference matches; an unknown
reference is recorded but cannot modify another action.

Webhook processing never calls a connector's side-effecting `execute` method.
It can only move `executing`, `uncertain`, `reconciling` or `manual_review`
records to a provider-confirmed terminal state. Read-probe reconciliation stays
available as the fallback when a webhook is missed. For Shipday, any
authenticated lifecycle event containing JASIM's deterministic order number
proves that dispatch insertion occurred; later delivery progress remains the
responsibility of the separate read-only tracking connector.

## Phase 12: durable, versioned generated worlds

Generated worlds now have explicit continuity. A one-off operation remains an
`ephemeral` task world, while an approved shop, service platform or community
can become a `persistent` or `evolving` world. A durable world is owned, has a
stable world key and can be attached to a conversation so later requests are
interpreted in that world's context without requiring a hard-coded Food, Fleet,
Shop or Membership screen.

The composer distinguishes an ordinary operation inside an attached world from
an explicit request to evolve its structure. The operation gets an ephemeral
execution view and does not create a platform version. An explicit structural
change merges generated participants, entities, capabilities, workflows,
policies and UI components with the active world and emits a scoped `PERSIST`
step. Creating a separate new platform does not silently mutate the attached
one.

Persistence is approval-gated and append-only. Every accepted structural
change is stored as a draft snapshot and then selected as the active semantic
version; the preceding active version is retired. Interrupted activation is
resumable through the same request key. Content and request
digests make retries idempotent. Structural additions normally produce a minor
version, policy-only edits a patch, and removals or incompatible changes a
major version. Version history records the parent, actor, source task, change
request and normalized diff.

Rollback never edits or deletes history. It generates a new approved version
from an older snapshot, records the rollback relationship, and activates that
new version through the same generated-plan executor. Conversation attachment
and detachment are ownership checked, and archived worlds can no longer evolve.

## Phase 13: signed capability binder and isolated execution

An assimilated source file can now become an executable capability without
being imported into JASIM's process. The release path is:

1. rebuild the content-addressed package from its approved DNA candidate;
2. pass the static integrity, contract, permission and secret checks;
3. send the immutable package and explicit contract tests to a separately
   deployed sandbox provider;
4. require a passing `isolated` evaluation that identifies the exact payload
   digest and confirms that execution really occurred;
5. issue an Ed25519 `execution_release` signature;
6. verify that signature again in `SignedCapabilityBinder`, bind the package to
   its reviewed `package:*` capability ID, and expose it as a runtime connector
   only after canary promotion.

The normal DNA activation route can no longer activate a capability from an
executor name alone. It requires a one-use authorization created by the signed
binder, and the resulting gene version preserves the binding and package
digest in its specification. Knowledge, workflow, policy, UI and world genes
remain on the non-executable DNA path. `core_patch` is still forbidden here.

Learned packages are pure computation in this phase. Their sandbox policy has
no network, filesystem, environment variables or child processes, uses a
read-only root, and caps time, memory and output. Payments, publication,
database access and delivery continue through JASIM's existing mediated,
approval-aware connectors; a learned package cannot bypass them by declaring a
permission. Dependencies must be self-contained and reviewed.

Inputs and outputs are checked against a fail-closed JSON Schema subset at the
kernel boundary. Signatures and payload digests are reverified on every
execution. A sandbox policy violation, changed package, oversized output or
contract mismatch fails the step; security violations quarantine and disable
the connector.

The API adds `dna.releasePackage` and `dna.promoteReleasedCapability`. Configure:

- `JASIM_PACKAGE_SIGNING_KEY_ID`
- `JASIM_PACKAGE_SIGNING_PRIVATE_KEY`
- `JASIM_PACKAGE_SIGNING_PUBLIC_KEY`
- `JASIM_CAPABILITY_SANDBOX_URL`
- `JASIM_CAPABILITY_SANDBOX_TOKEN`
- optional `JASIM_CAPABILITY_SANDBOX_PROVIDER_ID`

Production requires HTTPS for the sandbox. There is deliberately no in-process
JavaScript, Python, worker-thread or child-process fallback when isolation is
missing.

## Phase 14: durable signed-release hydration

Signed capability bindings now survive application restarts in
`capability_release_bindings`. The record stores the signed envelope, binding,
DNA version, resource policy, lifecycle state and execution counters, but does
not duplicate source bytes. Source remains in the SHA-256-addressed
`DNAArtifactStore`.

Before active DNA is resolved for a goal, the configured runtime loads durable
bindings and reconstructs each one from its signed envelope plus the original
content-addressed source. Hydration repeats bundle integrity, Ed25519 trust,
payload digest, isolated evaluation, sandbox identity, permission, dependency
and JSON contract checks. It also requires the exact gene version to have the
same candidate, `package:*` executor, release binding, package digest and
`active` or `canary` state.

Missing or non-executable records are skipped. A DNA-state mismatch disables
the binding. A changed signature, source, manifest or package identity
quarantines it and increments its durable safety counters. Quarantined and
disabled releases are never registered as connectors. Execution successes,
failures and policy violations update the durable binding, so a restart cannot
erase ordinary runtime evidence.

Release creation first stores a disabled canary record, then activates DNA,
then persists the gene link and optional promotion. A failed promotion write
disables the in-memory connector and persists that disabled state when storage
is available. Concurrent inserts use immutable identity checks rather than an
upsert that could overwrite a different unique package record.

Run `db/migrations/0006_durable_capability_releases.sql` before enabling signed
capability releases in an existing database. If the migration, verification
key or sandbox is unavailable, learned code remains unavailable; JASIM never
falls back to executing it inside the kernel.

## Remaining path to the full vision

The next implementation stages are:

1. Real geolocation, catalog/inventory, publication and identity connectors;
   each is opt-in and reviewed like payment and fulfillment.
2. A Core Evolution Lab with replay tests, security tests, canary rollout and
   rollback to a signed kernel version.
3. End-to-end product hardening: generated-form renderer coverage, observability,
   load tests, accessibility, multilingual UX, provider sandbox certification
   and operational recovery drills.

## Phase 15: Core Evolution Lab foundation

Kernel improvements now have a separate, inert lifecycle. `core_patch` remains
forbidden from `dna_versions`; it can only be referenced by a
`CorePatchCandidate` tied to an immutable kernel baseline.

The first lab boundary adds:

- immutable baseline identity through kernel, manifest and test-suite digests;
- critical-risk patch candidates with declared scope, effects, tests and
  rollback plan;
- explicit gate results for compilation, integration, schema, migration,
  replay, security, performance, cost and reproducible build checks;
- an append-only transition ledger with content digests;
- a fail-closed lifecycle that cannot jump from submission to shadow, canary or
  active; and
- build approval only after every required gate has passed.

This foundation does not yet build or deploy a kernel artifact. Later lab
stages will add isolated builders, replay workers, signing, shadow traffic,
canary routing, monitoring and automatic rollback. Run
`db/migrations/0007_core_evolution_foundation.sql` before enabling durable lab
state.

## Phase 16: reproducible baseline and isolated evaluation boundary

`KernelBaselineBuilder` now creates a real baseline only from an explicit list
of regular files under one resolved project root. It rejects absolute paths,
root escapes, symbolic-link artifacts, duplicate declarations and oversized
files. The manifest records a digest and size for every kernel, configuration
and test artifact. Aggregate kernel, test-suite and manifest digests are stable
across ordering and generation time, so the same tree produces the same
identity.

Core patches are evaluated by a separately deployed
`RemoteCoreEvolutionLabProvider`. The URL must use HTTPS in production, the
provider receives an immutable candidate and baseline identity plus a resource
policy that forbids network, environment and production-database access, and
there is no in-process build fallback. Returned reports are rejected unless
their candidate, source, baseline, provider and requested replay suite match
exactly.

`CoreReplayEvaluator` independently compares baseline and candidate
observations. It fails closed on status drift, changed outcomes or side effects,
missing evidence, fewer approval boundaries, excessive latency or cost, and any
safety incident outside the case policy. `CoreEvolutionEvaluator` records the
remote gates and a locally recomputed replay gate, but never approves the build
or starts shadow/canary traffic. Those remain separate human-authorized stages.

The admin API exposes asynchronous submit/status/finalize/cancel operations only when the deployment
configures `JASIM_CORE_LAB_URL` and `JASIM_CORE_LAB_TOKEN`; an optional
`JASIM_CORE_LAB_PROVIDER_ID` binds returned reports to a named provider. Missing
configuration fails closed and never selects a local builder.
## Phase 17 — Separate Core Evolution Lab service

The repository now contains a standalone service under `services/core-evolution-lab`.
It authenticates the caller, resolves
source and baseline inputs exclusively by SHA-256 content references, and verifies
the isolated report against the original candidate, baseline, gate set, and replay
fixtures before returning it to JASIM.

The Docker runner is fail-closed. It requires a digest-pinned image already present
on the lab host and starts it without a shell, outbound networking, inherited JASIM
secrets, Linux capabilities, or a writable root filesystem. Memory, CPU, processes,
open files, execution time, stdout/stderr, and report size are bounded. Inputs are
mounted read-only and the only writable bind mount is a fresh per-job output folder.
There is deliberately no in-process evaluator fallback.

Core-patch source is no longer accepted as an arbitrary text blob. It must be a
`core_patch_bundle` whose file operations have normalized relative paths, individual
content digests, a target version, and a base manifest digest. The lab rejects any
file outside the candidate's declared scope. The evaluator image independently
re-hashes the source, verifies every baked baseline artifact, applies the bundle in
a tmpfs workspace, derives a deterministic candidate manifest, and runs only gate
commands baked into the reviewed image. It cannot accept commands from the patch.

Command logs and built-in gate evidence are emitted as content-addressed artifacts.
The host verifies each digest and persists evidence in the configured immutable
artifact store before accepting the report; dangling evidence links
cause the entire evaluation to fail. Replay is also fail-closed: the default image
returns `uncertain` observations. A real deployment must bake a reviewed
`replayCommand` adapter into `evaluator-image/policy.json`; its output is validated
against the immutable fixture IDs and then re-evaluated again by JASIM's local replay
verifier. Security, performance, and cost gates likewise remain failed until the
image contains reviewed evaluators for them.

Build the evaluator image with `npm run build:core-lab-image`. The build requires
`JASIM_CORE_LAB_NODE_IMAGE` to be a digest-pinned base image and prints the resulting
local image ID. Configure that `sha256:...` ID as `JASIM_CORE_LAB_IMAGE`; floating
tags are rejected and runtime pulls are disabled.

Deployment remains a separate operational step: provision a dedicated Docker host
(preferably rootless), publish the reviewed evaluator image, configure the artifact
roots and HTTPS boundary, and then point the main JASIM service at it using the
existing `JASIM_CORE_LAB_URL` and token settings. This phase does not make a patch
active and does not bypass human build/canary approval.

## Phase 18 — Durable asynchronous evolution jobs

Core evaluation no longer occupies one HTTP request for up to thirty minutes.
`POST /v1/core-evolution-jobs` validates and fingerprints a request, stores it as an
immutable artifact, and returns `202` with a job location. Status, report retrieval,
and cancellation are separate short requests. The retired synchronous endpoint
returns `410` so a proxy timeout can never be mistaken for an evaluation result.

The scheduler is deliberately domain-neutral. A job kind is an open versioned
identifier rather than a food, commerce, vehicle, or core enum. Payloads and results
are immutable content addresses; the database stores lifecycle, idempotency,
attempts, optimistic revision, cancellation, and expiring worker leases. A worker
that dies loses its lease and the job is recovered or timed out. An unknown kind is
quarantined until a reviewed handler is registered; it is never executed as an
arbitrary command.

Core evolution is one reviewed handler (`core_evolution.evaluate`) on that general
runtime. The main JASIM service submits, polls, and later finalizes the signed report.
Finalization locally recomputes replay gates and remains separate from human approval,
build signing, shadow traffic, canary promotion, activation, and rollback. Thus the
kernel can evolve without self-modifying the live process.

Artifact backends are filesystem or S3-compatible object storage. S3 writes use a
conditional create plus SHA-256 checksums; filesystem writes use a temporary file
and atomic hard-link publication. Every read re-hashes bytes before they can affect
execution. Apply migration `0008_async_generative_jobs.sql` before starting the lab.
