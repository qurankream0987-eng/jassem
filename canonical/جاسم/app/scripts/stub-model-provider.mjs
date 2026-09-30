/**
 * A MODEL PROVIDER THAT ANSWERS, SO THE WIRE CAN BE MEASURED WITHOUT ONE.
 *
 * ─── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────
 *
 * The question «if we connect a provider, does JASIM work?» cannot be answered
 * by reading code and cannot be answered by a test suite that mocks the
 * gateway — the gateway is exactly the part in question. It is answered by
 * putting a real HTTP provider at the other end of the real socket and driving
 * a real turn through the real interface.
 *
 * This measures THE WIRE: env resolution, HTTP shape, response parsing, schema
 * validation, persistence, and what the interface does with the result. It says
 * NOTHING about whether a real model would produce a good plan, and it must
 * never be mistaken for evidence that it would.
 *
 *   A WIRE THAT CARRIES A STUB'S ANSWER WILL CARRY A MODEL'S ANSWER
 *   != A STUB'S ANSWER IS AS GOOD AS A MODEL'S
 *
 * It is OpenAI-compatible because JASIM already supports that provider shape,
 * so nothing in the runtime is bent to accommodate this. Point
 * MODEL_GATEWAY_BASE_URL at it and JASIM cannot tell it from a vendor.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.STUB_MODEL_PORT || 4010);

/** A minimal artifact that satisfies the runtime's own schema, and no more. */
function artifactFor(goal) {
  const objective = String(goal || "").slice(0, 3900) || "unstated goal";
  return {
    taskDNA: {
      objective,
      summary: "A stub provider answered so the connection could be measured.",
      intentType: "generic",
      actors: ["requester"],
      objects: [],
      actions: ["clarify"],
      constraints: {},
      requiredCapabilities: [],
      confidence: 0.5,
      unresolved: ["This came from a stub provider, not from a model."],
    },
    plan: {
      summary: "One advisory step.",
      steps: [
        {
          id: "step-1",
          name: "Ask for what is missing",
          description: "Confirm the details before anything is attempted.",
          capability: "notify",
          inputs: {},
          dependencies: [],
          risk: "none",
          requiresApproval: false,
        },
      ],
    },
    world: {
      name: "Stub world",
      description: "Task-scoped world produced by the stub provider.",
      continuity: "ephemeral",
      participants: [],
      entities: [],
      capabilities: [],
      policies: [],
    },
  };
}

/**
 * The conversation turn asks for a different contract from the task path: a
 * discriminated Output Envelope rather than a task artifact. A real model tells
 * them apart by reading the prompt, so this does too — by the one key only the
 * envelope prompt names.
 */
function envelopeFor(goal) {
  return {
    version: 1,
    decisionId: randomUUID(),
    kind: "text",
    content:
      "هذه إجابةٌ من مزوّدٍ وهميّ وُضع لقياس السلك، لا من نموذج. " +
      `وصلني: ${String(goal || "").slice(-300) || "(لا شيء)"}`,
    confidence: 0.5,
  };
}

function answerFor(prompt) {
  return /decisionId|Output Envelope|ephemeral_bubble/i.test(prompt)
    ? envelopeFor(prompt)
    : artifactFor(prompt);
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let goal = "";
    try {
      const parsed = JSON.parse(body || "{}");
      goal = (parsed.messages ?? []).map((m) => m.content).join("\n").slice(0, 4000);
    } catch {
      // A body this cannot read is still a request the wire delivered.
    }
    const content = JSON.stringify(answerFor(goal));
    const payload = {
      id: "stub-1",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "stub-model",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    };
    console.log(`[stub] ${req.method} ${req.url} -> 200 (${content.length}b)`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`[stub] listening on :${PORT}`));
