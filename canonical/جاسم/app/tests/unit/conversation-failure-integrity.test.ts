import { describe, expect, it, vi } from "vitest";
import { userFacingRuntimeError } from "../../src/lib/runtime-error-copy";
import { RUNTIME_STATE_COPY } from "../../src/lib/runtime-state-copy";

/**
 * CONVERSATION FAILURE INTEGRITY.
 *
 * The invariant: `USER_MESSAGE_ACCEPTED != MODEL_RESPONSE_SUCCEEDED`.
 *
 * The canonical half was already correct and is proven in the report against
 * the database and the tRPC projection: `routeRuntimeConversationTurn` writes
 * the user's message in its own committed statement before it calls the model,
 * so a provider failure cannot remove it. This file covers the half that was
 * broken — what the client shows, and what it says.
 *
 * The end-to-end browser proof (failure → refresh → reopen → retry) lives in
 * `tests/ui/capture-shell.test.ts`, gated on a running dev server.
 */

const CATEGORIES = [
  // 1 — Model Gateway unavailable
  { code: "MODEL_GATEWAY_UNAVAILABLE", label: "تعذّر الوصول إلى نموذج الذكاء" },
  // 2 — Provider authentication failure
  { code: "PROVIDER_AUTH_FAILED", label: undefined },
  // 3 — Provider timeout
  { code: "PROVIDER_TIMEOUT", label: undefined },
  // 4 — Invalid model response
  { code: "MODEL_GATEWAY_INVALID_OUTPUT", label: "وصل ردّ غير مكتمل من النموذج" },
  // 5 — Budget exceeded before the provider call
  { code: "MODEL_BUDGET_EXCEEDED", label: "بلغ هذا الطلب حدّه المسموح من استدعاءات النموذج" },
  { code: "MODEL_CONTEXT_TOO_LARGE", label: "السياق أكبر من أن يُرسَل كاملًا" },
  { code: "BLOCKED_BY_PROVIDER", label: "المزوّد المطلوب غير متاح" },
  { code: "INCONCLUSIVE", label: "النتيجة غير مؤكّدة" },
];

/** Anything an operator may read and a user may not. */
const OPERATOR_STRINGS = [
  "JASIM_MODEL_PROVIDER",
  "JASIM_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MODEL_GATEWAY_API_KEY",
  "API key",
  "api key",
  "Bearer ",
  "at Object.",
  "at async",
  "ModelGateway",
  "TRPCError",
  "Error:",
  "stack",
];

function silentConsole<T>(fn: () => T): T {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return fn();
  } finally {
    warn.mockRestore();
  }
}

describe("failure copy — Arabic, and nothing an operator wrote", () => {
  for (const { code, label } of CATEGORIES) {
    it(`${code} is translated`, () => {
      const message = silentConsole(() =>
        userFacingRuntimeError(Object.assign(new Error(`${code}: internal detail`), { code })),
      );
      if (label) expect(message).toContain(label);
      // Arabic, not a code and not English prose.
      expect(message).toMatch(/[؀-ۿ]/);
      expect(message).not.toContain(code);
    });
  }

  it("the gateway's real not-configured sentence never reaches the user", () => {
    // Verbatim from `resolveConfig` — this is what shipped into the
    // conversation before the fix, environment variable and all.
    const raw =
      "No model service is configured. Configure JASIM_MODEL_PROVIDER with its " +
      "provider API key before creating a task.";
    const message = silentConsole(() => userFacingRuntimeError(new Error(raw)));
    expect(message).toBe(
      `${RUNTIME_STATE_COPY.MODEL_GATEWAY_UNAVAILABLE!.label}. ` +
        `${RUNTIME_STATE_COPY.MODEL_GATEWAY_UNAVAILABLE!.guidance}`,
    );
    for (const leak of OPERATOR_STRINGS) expect(message).not.toContain(leak);
  });

  it("no category leaks operator text, a stack frame or a variable name", () => {
    const raws = [
      "MODEL_GATEWAY_UNAVAILABLE: openai model service returned HTTP 401: {\"error\":\"Incorrect API key provided: sk-live-abc\"}",
      "PROVIDER_TIMEOUT: Unable to reach the gemini model service: fetch failed\n    at async ModelGateway.generate (/app/api/runtime/model-gateway.ts:512:24)",
      "MODEL_BUDGET_EXCEEDED: query runtime.turnsCreate has already used its 8 permitted model call(s)",
    ];
    for (const raw of raws) {
      const message = silentConsole(() => userFacingRuntimeError(new Error(raw)));
      for (const leak of OPERATOR_STRINGS) {
        expect(message, `${leak} in "${message}"`).not.toContain(leak);
      }
      expect(message).not.toContain("sk-live-abc");
      expect(message).not.toContain("model-gateway.ts");
    }
  });

  it("an unrecognised failure gets an honest sentence, not an invented cause", () => {
    const message = silentConsole(() => userFacingRuntimeError(new Error("something nobody mapped")));
    expect(message).toBe("تعذّر إكمال هذا الطلب. لم يُحفَظ شيء، ويمكنك إعادة المحاولة.");
    expect(message).not.toContain("something nobody mapped");
  });

  it("the raw detail is kept for whoever is debugging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    userFacingRuntimeError(new Error("PROVIDER_TIMEOUT: gateway timeout from provider x"));
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls.flat().join(" "))).toContain("gateway timeout");
    warn.mockRestore();
  });

  it("a non-Error rejection does not produce '[object Object]'", () => {
    const message = silentConsole(() => userFacingRuntimeError({ weird: true }));
    expect(message).not.toContain("[object");
    expect(message).toMatch(/[؀-ۿ]/);
  });
});

describe("the notice is a client rendering, never canonical truth", () => {
  it("the failure path refetches canonical instead of inserting a message", () => {
    // The distinction the invariant rests on. Re-inserting locally would mint
    // an id the server never issued and risk a duplicate on retry; refetching
    // takes the row the server already committed.
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../src/hooks/useJasimChat.ts"),
      "utf8",
    ) as string;
    const failureBlock = source.slice(source.indexOf("} catch (error) {"));
    expect(failureBlock).toContain("utils.runtime.conversationsGet.invalidate");
    expect(failureBlock).toContain("setTurnFailure(");
    // No canonical message is fabricated on the failure path.
    expect(failureBlock.slice(0, failureBlock.indexOf("finally"))).not.toContain("MESSAGE_ROLES.ASSISTANT");
  });

  it("the notice lives beside the canonical list, not inside it", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../src/hooks/useJasimChat.ts"),
      "utf8",
    ) as string;
    // Merged only at the point of return, so a refetch replacing the canonical
    // half cannot drop it and it can never be mistaken for a stored message.
    expect(source).toContain("messages: turnFailure ? [...messages, turnFailure] : messages");
    // And it is scoped to one conversation and one attempt.
    expect(source).toMatch(/setTurnFailure\(null\)[\s\S]{0,400}setActiveConversationId\(id\)/);
    expect(source).toMatch(/setTurnFailure\(null\);[\s\S]{0,200}createTurnMutation\.mutateAsync/);
  });

  it("a turn in flight cannot be submitted twice", () => {
    // The composer and its send control are disabled while `isLoading`, which
    // is set before the mutation and cleared in `finally` — so the Enter key
    // and the button are both closed for the duration of a turn.
    const input = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../src/components/chat/ChatInput.tsx"),
      "utf8",
    ) as string;
    expect((input.match(/disabled=\{disabled \|\| isLoading\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
