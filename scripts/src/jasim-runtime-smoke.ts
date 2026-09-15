const origin = process.env.JASIM_RUNTIME_ORIGIN ?? "http://localhost:80";
const cookieHeader = new Headers();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookieHeader.get("cookie") ? { cookie: cookieHeader.get("cookie")! } : {}),
      ...init?.headers,
    },
  });
  const cookie = response.headers.get("set-cookie");
  if (cookie) cookieHeader.set("cookie", cookie.split(";")[0]);
  return response;
}

const create = await request("/api/runtime/tasks", {
  method: "POST",
  body: JSON.stringify({
    goal: "Create a bilingual knowledge platform for field teams.",
  }),
});
  if (create.status === 503) {
    const unavailable = (await create.json()) as { error?: string };
    assert(
      unavailable.error?.includes("model"),
      "An unavailable model service must explain why no task was created.",
    );
    process.stdout.write("JASIM model-unavailable behavior smoke test passed.\n");
    return;
  }
  assert(create.status === 201, "Expected a task composed by the configured model service.");
  const task = (await create.json()) as {
    id: string;
    status: string;
    world: {
      taskDNA?: { interpretationSource?: string };
      plan?: { steps?: unknown[] };
      world?: { name?: string };
    };
  };
assert(task.status === "awaiting_input", "New task must request context.");
  assert(
    task.world.taskDNA?.interpretationSource === "model-gateway",
    "New tasks must use model-generated Task DNA.",
  );
  assert(
    Array.isArray(task.world.plan?.steps) && task.world.plan.steps.length > 0,
    "The validated model plan must include at least one step.",
  );
  assert(task.world.world?.name, "The validated model world must have a name.");

const premature = await request(`/api/runtime/tasks/${task.id}/actions`, {
  method: "POST",
  body: JSON.stringify({
    actionId: "execute-plan",
    idempotencyKey: `jasim-smoke-${task.id}-premature`,
  }),
});
assert(premature.status === 400, "Execution must not bypass its approval state.");

const contextBody = JSON.stringify({
  actionId: "provide-context",
  idempotencyKey: `jasim-smoke-${task.id}-context`,
  input: { audience: "field teams", languages: ["Arabic", "English"] },
});
const [context, duplicateContext] = await Promise.all([
  request(`/api/runtime/tasks/${task.id}/actions`, { method: "POST", body: contextBody }),
  request(`/api/runtime/tasks/${task.id}/actions`, { method: "POST", body: contextBody }),
]);
assert(context.status === 200 && duplicateContext.status === 200, "Concurrent context retry failed.");
const contextResult = (await context.json()) as { status: string; events: { id: string }[] };
const duplicateContextResult = (await duplicateContext.json()) as { status: string; events: { id: string }[] };
assert(contextResult.status === "awaiting_approval", "Context must lead to explicit approval.");
assert(
  JSON.stringify(contextResult) === JSON.stringify(duplicateContextResult),
  "A duplicate request must return the original durable result.",
);
const unauthorizedReplay = await fetch(`${origin}/api/runtime/tasks/${task.id}/actions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: contextBody,
});
assert(
  unauthorizedReplay.status === 404,
  "A second session must not replay another session's idempotent result.",
);
const bogusBearer = await fetch(`${origin}/api/runtime/overview`, {
  headers: { authorization: "Bearer session-forged.0.invalidsig" },
});
assert(bogusBearer.status === 401, "Forged or expired bearer tokens must be rejected.");

const approval = await request(`/api/runtime/tasks/${task.id}/actions`, {
  method: "POST",
  body: JSON.stringify({
    actionId: "approve-plan",
    idempotencyKey: `jasim-smoke-${task.id}-approval`,
    approval: true,
  }),
});
assert(approval.status === 200, "Approval action failed.");
const approvalResult = (await approval.json()) as {
  status: string;
  events: { type: string }[];
};
assert(approvalResult.status === "ready", "Approval must make the plan ready, not complete.");
assert(
  approvalResult.events.some((event) => event.type === "plan_approved") &&
    !approvalResult.events.some((event) => event.type === "completed"),
  "Approval must not emit a false completion event.",
);

const execution = await request(`/api/runtime/tasks/${task.id}/actions`, {
  method: "POST",
  body: JSON.stringify({
    actionId: "execute-plan",
    idempotencyKey: `jasim-smoke-${task.id}-execution`,
  }),
});
assert(execution.status === 200, "Execution attempt failed unexpectedly.");
const result = (await execution.json()) as {
  status: string;
  events: { type: string }[];
};
assert(result.status === "blocked", "Unassigned execution must report blocked.");
assert(
  result.events.at(-1)?.type === "execution_blocked",
  "Blocked execution must emit a truthful event.",
);

process.stdout.write("JASIM generic runtime smoke test passed.\n");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});