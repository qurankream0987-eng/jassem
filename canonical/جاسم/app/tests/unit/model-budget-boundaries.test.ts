import { EventEmitter } from "node:events";
import { AsyncResource } from "node:async_hooks";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelBudgetContextMissingError,
  currentModelCallBudget,
  requireModelExecutionContext,
  reserveModelCall,
  runWithModelCallBudget,
  runWithReestablishedModelBudget,
} from "../../api/runtime/model-call-budget";

/**
 * WAVE 2.1 PART 2 — does the budget context actually survive the async patterns
 * JASIM uses?
 *
 * Wave 2 asserted that `AsyncLocalStorage` carries the context and named that as
 * the thing to doubt first. Asserting it is not proving it, and the patterns
 * differ: promises and timers propagate context, but `EventEmitter.emit()` is
 * synchronous and runs listeners in the *emitter's* context, not the
 * registrar's. That difference is invisible at the call site and is exactly the
 * kind of thing that turns a bounded call into an unbounded one.
 *
 * These tests measure the behaviour rather than restating it.
 */

const inScope = <T>(fn: () => Promise<T>, maxModelCalls = 4): Promise<T> =>
  runWithModelCallBudget({ origin: "TEST", label: "boundary", maxModelCalls }, fn);

describe("PART 2 — context propagation through JASIM's async patterns", () => {
  it("CONTEXT_PRESERVED: promise chains", async () => {
    const label = await inScope(() =>
      Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => currentModelCallBudget()?.label),
    );
    expect(label).toBe("boundary");
  });

  it("CONTEXT_PRESERVED: setTimeout", async () => {
    const label = await inScope(
      () =>
        new Promise<string | undefined>((resolve) =>
          setTimeout(() => resolve(currentModelCallBudget()?.label), 1),
        ),
    );
    expect(label).toBe("boundary");
  });

  it("CONTEXT_PRESERVED: queueMicrotask", async () => {
    const label = await inScope(
      () =>
        new Promise<string | undefined>((resolve) =>
          queueMicrotask(() => resolve(currentModelCallBudget()?.label)),
        ),
    );
    expect(label).toBe("boundary");
  });

  it("CONTEXT_PRESERVED: setImmediate and nested timers", async () => {
    const label = await inScope(
      () =>
        new Promise<string | undefined>((resolve) =>
          setImmediate(() =>
            setTimeout(() => resolve(currentModelCallBudget()?.label), 1),
          ),
        ),
    );
    expect(label).toBe("boundary");
  });

  it("CONTEXT_PRESERVED: nested functions several frames deep", async () => {
    const deep = () => currentModelCallBudget()?.label;
    const middle = async () => deep();
    const outer = async () => middle();
    expect(await inScope(outer)).toBe("boundary");
  });

  it("CONTEXT_PRESERVED: Promise.all shares ONE counter, it does not clone it", async () => {
    // The important half. If parallel branches each saw their own counter, a
    // fan-out of ten would multiply the ceiling by ten.
    await inScope(async () => {
      await Promise.all([
        Promise.resolve().then(() => reserveModelCall("PRIMARY_ATTEMPT")),
        Promise.resolve().then(() => reserveModelCall("PRIMARY_ATTEMPT")),
        Promise.resolve().then(() => reserveModelCall("PRIMARY_ATTEMPT")),
      ]);
      expect(currentModelCallBudget()!.snapshot().reserved).toBe(3);
      expect(currentModelCallBudget()!.snapshot().remaining).toBe(1);
    }, 4);
  });

  it("CONTEXT_PRESERVED: error and retry paths", async () => {
    const label = await inScope(async () => {
      try {
        await Promise.reject(new Error("provider exploded"));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1)); // backoff
        return currentModelCallBudget()?.label;
      }
      return undefined;
    });
    expect(label).toBe("boundary");
  });

  it("CONTEXT_PRESERVED: a spend inside a catch block still counts", async () => {
    await inScope(async () => {
      try {
        throw new Error("first attempt failed");
      } catch {
        reserveModelCall("RETRY_ATTEMPT");
      }
      expect(currentModelCallBudget()!.snapshot().reserved).toBe(1);
    }, 2);
  });

  it("CONTEXT_PRESERVED: async generators and for-await", async () => {
    async function* stream(): AsyncGenerator<string | undefined> {
      yield currentModelCallBudget()?.label;
      await new Promise((resolve) => setTimeout(resolve, 1));
      yield currentModelCallBudget()?.label;
    }
    const seen: Array<string | undefined> = [];
    await inScope(async () => {
      for await (const value of stream()) seen.push(value);
    });
    expect(seen).toEqual(["boundary", "boundary"]);
  });

  it("CONTEXT_PRESERVED: a fire-and-forget task started inside the scope", async () => {
    // `void extractAndStoreConversationMemories(...)` in jasim-runtime.ts is
    // exactly this shape: started inside the request, outliving it. It keeps
    // charging the request that started it, which is the correct attribution.
    let observed: string | undefined = "not-run";
    const finished = new Promise<void>((resolve) => {
      void inScope(async () => {
        void (async () => {
          await new Promise((r) => setTimeout(r, 5));
          observed = currentModelCallBudget()?.label;
          resolve();
        })();
      });
    });
    await finished;
    expect(observed).toBe("boundary");
  });
});

describe("PART 2 — boundaries that do NOT propagate, measured rather than assumed", () => {
  it("UNSAFE: a plain EventEmitter listener runs in the EMITTER's context", async () => {
    const emitter = new EventEmitter();
    let seenInListener: string | undefined = "not-run";

    await inScope(async () => {
      emitter.on("work", () => {
        seenInListener = currentModelCallBudget()?.label;
      });
    });

    // Emitted from outside any scope — `emit` is synchronous, so the listener
    // inherits the emitter's context, not the one it was registered in.
    emitter.emit("work");
    expect(seenInListener).toBeUndefined();
  });

  it("the fail-closed default turns that gap into a refusal, not a silent spend", () => {
    const emitter = new EventEmitter();
    let outcome = "not-run";
    emitter.on("work", () => {
      try {
        reserveModelCall("PRIMARY_ATTEMPT");
        outcome = "SPENT_UNBOUNDED";
      } catch (error) {
        outcome = error instanceof ModelBudgetContextMissingError ? "REFUSED" : "OTHER";
      }
    });
    emitter.emit("work");
    // This is the whole point of Part 1: the transport can fail, and the
    // invariant still holds.
    expect(outcome).toBe("REFUSED");
  });

  it("EXPLICIT_SCOPE_REESTABLISHED: AsyncResource.bind fixes the emitter case", async () => {
    const emitter = new EventEmitter();
    let seenInListener: string | undefined = "not-run";
    await inScope(async () => {
      emitter.on(
        "work",
        AsyncResource.bind(() => {
          seenInListener = currentModelCallBudget()?.label;
        }),
      );
    });
    emitter.emit("work");
    expect(seenInListener).toBe("boundary");
  });

  it("EXPLICIT_SCOPE_REESTABLISHED: a snapshot can rebuild a context across a hard boundary", async () => {
    const snapshot = await inScope(async () => {
      reserveModelCall("PRIMARY_ATTEMPT");
      reserveModelCall("PRIMARY_ATTEMPT");
      return currentModelCallBudget()!.snapshot();
    }, 4);
    expect(snapshot.remaining).toBe(2);

    // The far side is bounded by what was LEFT, never by the original ceiling.
    const rebuilt = await runWithReestablishedModelBudget(snapshot, async () =>
      currentModelCallBudget()!.snapshot(),
    );
    expect(rebuilt.maxModelCalls).toBe(2);
    expect(rebuilt.label).toContain("re-established");
  });

  it("a rebuilt context is a fresh counter, and says so — it cannot refund the original", async () => {
    const snapshot = { origin: "TEST" as const, label: "crossed", remaining: 1 };
    await runWithReestablishedModelBudget(snapshot, async () => {
      reserveModelCall("PRIMARY_ATTEMPT");
      expect(() => reserveModelCall("PRIMARY_ATTEMPT")).toThrow(/MODEL_BUDGET_EXCEEDED/);
    });
  });

  it("requireModelExecutionContext is the accessor that cannot be mis-read", async () => {
    expect(() => requireModelExecutionContext("a scheduler callback")).toThrow(
      ModelBudgetContextMissingError,
    );
    await inScope(async () => {
      expect(requireModelExecutionContext("a scheduler callback").label).toBe("boundary");
    });
  });
});

// ── PART 14 — no ungoverned model call path, proven by reachability ─────────

/**
 * A grep proves what a file contains. It does not prove what the server can
 * reach, and "it is dead code" is a claim that stops being true the first time
 * someone adds an import.
 *
 * This walks the real module graph from the two entry points that exist —
 * `api/boot.ts` (the HTTP server) and `api/router.ts` (the tRPC surface) — and
 * asserts that the only reachable module which speaks to a model provider is
 * the gateway itself.
 */
const APP_ROOT = path.resolve(__dirname, "../..");
const ALIASES: Record<string, string> = {
  "@db": "db",
  "@contracts": "contracts",
  "@assets": "attached_assets",
  "@": "src",
};

function resolveImport(spec: string, from: string): string | undefined {
  let base: string;
  if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(from), spec);
  } else {
    const [head, ...rest] = spec.split("/");
    const aliased = ALIASES[head!];
    if (!aliased) return undefined; // a package, not a source file
    base = path.join(APP_ROOT, aliased, ...rest);
  }
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function reachableModules(entryPoints: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = entryPoints.map((entry) => path.join(APP_ROOT, entry));
  const importPattern = /(?:from|import)\s+["']([^"']+)["']/g;
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || file.includes(`${path.sep}dist${path.sep}`)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveImport(match[1]!, file);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return seen;
}

describe("PART 14 — every reachable model call goes through the gateway", () => {
  const reachable = reachableModules(["api/boot.ts", "api/router.ts"]);
  /**
   * Detecting "this file talks to a model provider" from source is a heuristic,
   * and the first version of it was wrong: matching `/messages` flagged
   * `block2/notifications.ts`, which posts to FCM
   * (`.../v1/projects/{id}/messages:send`) and to the WhatsApp Graph API
   * (`.../v19.0/{id}/messages`). Those are delivery endpoints, not models.
   *
   * So the detector looks for completion-endpoint shapes and for the one header
   * that only a model client sends. It is deliberately shape-based rather than a
   * vendor list, so a provider nobody has heard of yet is still caught — but it
   * is a heuristic, and the reachability walk is what makes it useful: it only
   * has to be right about the 90-odd modules the server can actually reach.
   */
  const PROVIDER_CALL =
    /chat\/completions|:generateContent|api\.(?:openai|anthropic|deepseek|mistral)\.(?:com|ai)|generativelanguage|["'`]anthropic-version["'`]|\/v1\/messages/;

  it("reaches a realistic slice of the app, so a pass is not an empty walk", () => {
    expect(reachable.size).toBeGreaterThan(60);
    expect([...reachable].some((file) => file.endsWith("api/runtime/jasim-runtime.ts"))).toBe(true);
    expect([...reachable].some((file) => file.endsWith("api/runtime/model-gateway.ts"))).toBe(true);
  });

  it("UNGOVERNED_ACTIVE_MODEL_CALL_PATHS = 0", () => {
    const offenders = [...reachable]
      .filter((file) => PROVIDER_CALL.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(APP_ROOT, file))
      .filter((file) => file !== path.join("api", "runtime", "model-gateway.ts"));
    expect(offenders).toEqual([]);
  });

  it("the legacy llm-router is unreachable, and stays that way", () => {
    // 1385 lines with six direct provider fetches, imported only by
    // unregistered routers and the dead `api/core` engines. Dead is fine; dead
    // and unwatched is how it comes back.
    const legacy = path.join(APP_ROOT, "api/core/llm-router.ts");
    expect(existsSync(legacy)).toBe(true);
    expect(reachable.has(legacy)).toBe(false);
  });
});

// ── PART 13 — the world-generation routing trap stays closed ───────────────

describe("PART 13 — a purpose label never stands in for the instance properties", () => {
  /**
   * The decision (documented in `model-policy.ts`): routing on `purpose` would
   * mean "a world is expensive", which breaks cheapest-sufficient on the most
   * frequent path. The behaviour is correct; the risk is a hand-written profile
   * that names `WORLD_GENERATION` and omits `worldGeneration: true`, silently
   * getting FAST_CHEAP for open-ended structural generation.
   *
   * This reads the actual call sites rather than trusting the convention.
   */
  const CALL_SITE_FILES = ["api/runtime/jasim-runtime.ts", "api/runtime/capability-registry.ts"];

  it("every production profile naming WORLD_GENERATION also sets the flag", () => {
    const offenders: string[] = [];
    for (const relative of CALL_SITE_FILES) {
      const source = readFileSync(path.join(APP_ROOT, relative), "utf8");
      // Each taskProfile literal, from `taskProfile: {` to its closing brace at
      // the same indentation.
      for (const match of source.matchAll(/taskProfile:\s*\{([\s\S]*?)\n(\s*)\},/g)) {
        const body = match[1]!;
        if (!body.includes('purpose: "WORLD_GENERATION"')) continue;
        if (!/worldGeneration:\s*true/.test(body)) {
          offenders.push(`${relative}: ${body.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("at least one such profile exists, so the check is not vacuous", () => {
    const source = readFileSync(path.join(APP_ROOT, "api/runtime/jasim-runtime.ts"), "utf8");
    expect(source).toContain('purpose: "WORLD_GENERATION"');
    expect(source).toMatch(/worldGeneration:\s*true/);
  });
});
