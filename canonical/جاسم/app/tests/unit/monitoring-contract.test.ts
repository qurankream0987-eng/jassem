/**
 * JASIM — A STANDING CONDITION IS ONE ENGINE, NOT ONE WATCHER PER SUBJECT.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   CONDITION_MATCHED != USER_NOTIFIED
 *   LEVEL             != EDGE
 *   UNKNOWN           != FALSE
 *   UNKNOWN           != ABSENT
 *   MONITORING AUTHORITY != EXECUTION AUTHORITY
 *
 * The contract half: the condition language, the three-valued verdict, the
 * edge/level rule and the ratchets. The live half — a conversation creating a
 * durable monitor and a real observation firing it — is
 * `tests/block31/monitoring-engine.test.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MONITOR_ACTION_KINDS,
  MONITOR_AUTHORITY_KEYS,
  MONITOR_EVALUATION_MODES,
  MONITOR_OPERATORS,
  MONITOR_REPEAT_POLICIES,
  MONITOR_RESULTS,
  MONITOR_SOURCE_CLASSES,
  MONITOR_STATES,
  MonitorError,
  assertNoMonitorAuthorityClaim,
  describeCondition,
  evaluateCondition,
  firesOn,
  transitionOf,
  validateCondition,
  type MonitorCondition,
} from "../../api/runtime/monitoring-runtime";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

// ── The vocabulary is closed and names nothing that is watched ───────────────

describe("the monitoring vocabulary", () => {
  it("names no subject, no industry and no device", () => {
    //   DOMAIN_MONITOR_TYPES_ADDED = 0 · DOMAIN_WATCHERS_ADDED = 0
    const FORBIDDEN = [
      "PRICE", "DELIVERY", "TEMPERATURE", "FLIGHT", "DEVICE", "STOCK",
      "INVENTORY", "PAYMENT", "VALVE", "GENERATOR", "SHIPMENT",
    ];
    const vocabulary = [
      ...MONITOR_SOURCE_CLASSES, ...MONITOR_STATES, ...MONITOR_EVALUATION_MODES,
      ...MONITOR_REPEAT_POLICIES, ...MONITOR_ACTION_KINDS, ...MONITOR_RESULTS,
      ...MONITOR_OPERATORS,
    ];
    for (const entry of vocabulary) {
      for (const word of FORBIDDEN) {
        expect(entry.toUpperCase(), entry).not.toContain(word);
      }
    }
  });

  it("exports no per-subject monitor, watcher or agent", () => {
    const text = source("api/runtime/monitoring-runtime.ts");
    const declared = [...text.matchAll(/export (?:type|function|const|class|async function) (\w+)/g)]
      .map((match) => match[1]!);
    for (const name of declared) {
      for (const word of ["Price", "Delivery", "Temperature", "Flight", "Device", "Stock", "Watcher", "Agent", "Daemon", "Cron"]) {
        expect(name, `${name} names ${word}`).not.toContain(word);
      }
    }
  });

  it("builds no second scheduler, observation system, ledger or notification truth", () => {
    const text = source("api/runtime/monitoring-runtime.ts");
    // It reads the canonical observation, the canonical ledger and the
    // canonical notification intent, and declares no table of its own.
    expect(text).toContain("observationFreshness");
    expect(text).toContain("createNotificationIntent");
    expect(text).not.toMatch(/pgTable\(/);
    for (const forbidden of ["setInterval(", "setTimeout(", "node-cron", "new Worker(", "cron.schedule"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // And the evaluation runs inside the duty cycle that already existed.
    const sweep = source("api/runtime/block2/jobs.ts");
    expect(sweep).toContain("sweepDueMonitors");
  });

  it("a monitor's only actions are notify and nothing", () => {
    //   MONITORING AUTHORITY != EXECUTION AUTHORITY
    // «إذا نزل السعر تحت ٩٥ اشترِ» is two things. This is the half that
    // detects; the purchase has to satisfy its own envelope elsewhere.
    expect([...MONITOR_ACTION_KINDS].sort()).toEqual(["NONE", "NOTIFY"]);
    const text = source("api/runtime/monitoring-runtime.ts");
    for (const forbidden of ["executeCapability", "createRuntimeRun", "commitAgreement", "materializeTransaction", "submitProductAction"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("every monitor authority key is also refused in model output", () => {
    for (const key of MONITOR_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });
});

// ── The condition language ───────────────────────────────────────────────────

describe("a condition is typed, closed and never executable", () => {
  it("accepts the operators the runtime owns", () => {
    for (const condition of [
      { op: "less_than", field: "value", value: 50 },
      { op: "greater_or_equal", field: "reading.celsius", value: 5 },
      { op: "equals", field: "status", value: "delivered" },
      { op: "contains", field: "tags", value: "urgent" },
      { op: "exists", field: "value" },
      { op: "changed", field: "status" },
      { op: "entered_state", field: "status", value: "CLOSED" },
      { op: "left_state", field: "status", value: "OPEN" },
      { op: "within_range", field: "value", min: 1, max: 9 },
      { op: "not", of: { op: "exists", field: "value" } },
      { op: "all", of: [{ op: "exists", field: "a" }, { op: "exists", field: "b" }] },
      { op: "any", of: [{ op: "exists", field: "a" }, { op: "exists", field: "b" }] },
    ]) {
      expect(() => validateCondition(condition), JSON.stringify(condition)).not.toThrow();
    }
  });

  it("refuses anything that is a program rather than a comparison", () => {
    for (const attempt of [
      { op: "equals", field: "value", value: "<script>x</script>" },
      { op: "equals", field: "value", value: "eval('1')" },
      { op: "equals", field: "value", value: "SELECT price FROM offerings" },
      { op: "equals", field: "value", value: "() => true" },
      { op: "equals", field: "value", value: "${secret}" },
      { op: "js", expression: "row.price < 50" },
      { op: "sql", query: "select 1" },
      { expression: "price < 50" },
    ]) {
      expect(() => validateCondition(attempt), JSON.stringify(attempt)).toThrow(MonitorError);
    }
  });

  it("refuses a field that is not a plain dotted path", () => {
    for (const field of ["value; DROP TABLE x", "../secret", "a b", "A.B", "value()"]) {
      expect(() => validateCondition({ op: "exists", field })).toThrow(MonitorError);
    }
  });

  it("refuses an undeclared key rather than dropping it", () => {
    expect(() =>
      validateCondition({ op: "less_than", field: "value", value: 5, pollMs: 1 }),
    ).toThrow(MonitorError);
  });

  it("cannot say that it already matched", () => {
    for (const claim of [{ triggered: true }, { notified: true }, { scopeId: "9" }, { approved: true }]) {
      expect(() => assertNoMonitorAuthorityClaim(claim), JSON.stringify(claim)).toThrow(/runtime's word/);
    }
  });

  it("will not nest further than anything lawful does", () => {
    let condition: MonitorCondition = { op: "exists", field: "value" };
    for (let depth = 0; depth < 8; depth += 1) condition = { op: "not", of: condition };
    expect(() => validateCondition(condition)).toThrow(/nests further/);
  });
});

// ── Three-valued, and never collapsed ────────────────────────────────────────

describe("a verdict has three values", () => {
  const lessThan50: MonitorCondition = { op: "less_than", field: "value", value: 50 };

  it("a missing fact is unknown, not false", () => {
    //   UNKNOWN != FALSE
    expect(evaluateCondition(lessThan50, {}, undefined)).toBe("UNKNOWN");
    expect(evaluateCondition(lessThan50, { value: 40 }, undefined)).toBe("TRUE");
    expect(evaluateCondition(lessThan50, { value: 60 }, undefined)).toBe("FALSE");
  });

  it("a comparison against the wrong kind of value is unknown", () => {
    expect(evaluateCondition(lessThan50, { value: "cheap" }, undefined)).toBe("UNKNOWN");
  });

  it("unknown survives `all` and `any` correctly", () => {
    const all: MonitorCondition = { op: "all", of: [lessThan50, { op: "exists", field: "b" }] };
    // One unknown and one true is unknown; one false makes the whole thing false.
    expect(evaluateCondition(all, { b: 1 }, undefined)).toBe("UNKNOWN");
    expect(evaluateCondition(all, { value: 60, b: 1 }, undefined)).toBe("FALSE");
    const any: MonitorCondition = { op: "any", of: [lessThan50, { op: "exists", field: "b" }] };
    expect(evaluateCondition(any, { b: 1 }, undefined)).toBe("TRUE");
    expect(evaluateCondition(any, {}, undefined)).toBe("UNKNOWN");
  });

  it("negating unknown is unknown", () => {
    expect(evaluateCondition({ op: "not", of: lessThan50 }, {}, undefined)).toBe("UNKNOWN");
  });

  it("`changed` means nothing without a previous reading", () => {
    const changed: MonitorCondition = { op: "changed", field: "status" };
    expect(evaluateCondition(changed, { status: "open" }, undefined)).toBe("UNKNOWN");
    expect(evaluateCondition(changed, { status: "open" }, { status: "open" })).toBe("FALSE");
    expect(evaluateCondition(changed, { status: "shut" }, { status: "open" })).toBe("TRUE");
  });

  it("`entered_state` is a transition, not a value", () => {
    const entered: MonitorCondition = { op: "entered_state", field: "status", value: "CLOSED" };
    // Already closed and still closed is not an entry.
    expect(evaluateCondition(entered, { status: "CLOSED" }, { status: "CLOSED" })).toBe("FALSE");
    expect(evaluateCondition(entered, { status: "CLOSED" }, { status: "OPEN" })).toBe("TRUE");
  });
});

// ── Edge and level ───────────────────────────────────────────────────────────

describe("level is not edge", () => {
  it("a repeat is distinguished from a rise", () => {
    expect(transitionOf("FALSE", "TRUE")).toBe("RISING");
    expect(transitionOf("TRUE", "TRUE")).toBe("REPEAT");
    expect(transitionOf("TRUE", "FALSE")).toBe("FALLING");
    expect(transitionOf(null, "TRUE")).toBe("RISING");
    expect(transitionOf("UNKNOWN", "TRUE")).toBe("RISING");
    expect(transitionOf("FALSE", "UNKNOWN")).toBe("NONE");
  });

  it("an EDGE monitor never fires on a repeat", () => {
    // The storm §10 exists to prevent: a poll every minute on an unchanged
    // fact.
    expect(firesOn("EDGE", "REPEATING", "REPEAT")).toBe(false);
    expect(firesOn("EDGE", "ONE_SHOT", "REPEAT")).toBe(false);
    expect(firesOn("EDGE", "REPEATING", "RISING")).toBe(true);
  });

  it("only a LEVEL monitor that explicitly repeats fires on a repeat", () => {
    expect(firesOn("LEVEL", "REPEATING", "REPEAT")).toBe(true);
    expect(firesOn("LEVEL", "ONE_SHOT", "REPEAT")).toBe(false);
  });

  it("nothing fires on falling or on nothing", () => {
    for (const mode of MONITOR_EVALUATION_MODES) {
      for (const repeat of MONITOR_REPEAT_POLICIES) {
        expect(firesOn(mode, repeat, "FALLING")).toBe(false);
        expect(firesOn(mode, repeat, "NONE")).toBe(false);
      }
    }
  });
});

// ── What a person is told ────────────────────────────────────────────────────

describe("a condition is rendered, never re-interpreted", () => {
  it("reads back as the comparison it is", () => {
    expect(describeCondition({ op: "less_than", field: "value", value: 50 })).toContain("<");
    expect(describeCondition({ op: "changed", field: "status" })).toContain("تغيّر");
    expect(
      describeCondition({
        op: "all",
        of: [
          { op: "less_than", field: "value", value: 50 },
          { op: "equals", field: "currency", value: "KWD" },
        ],
      }),
    ).toContain(" و ");
  });

  it("carries no code into a surface", () => {
    const rendered = describeCondition({ op: "equals", field: "status", value: "open" });
    expect(rendered).not.toMatch(/<|function|=>/);
  });
});

// ── The conversational boundary ──────────────────────────────────────────────

describe("the turn's monitoring branch", () => {
  const runtime = source("api/runtime/jasim-runtime.ts");

  it("lets a model name a subject and a condition, and nothing else", () => {
    const start = runtime.indexOf("const MonitoringRequestSchema");
    const schema = runtime.slice(start, start + 400);
    expect(schema).toContain(".strict()");
    for (const key of ["scopeId", "ownerId", "triggered", "approved"]) {
      expect(schema, key).not.toContain(key);
    }
  });

  it("creates no run, no DAG and no node", () => {
    //   «راقب السعر» IS NOT «ما السعر»
    const start = runtime.indexOf("// ── A STANDING CONDITION: WATCH");
    const end = runtime.indexOf("// ── A PERSISTENT WORLD: MATERIALIZE");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = runtime.slice(start, end);
    expect(block).toContain("respondRouted(");
    expect(block).not.toContain("createRuntimeRun(");
    expect(block).not.toContain("createRuntimeDag(");
  });

  it("is reached by the route alone, so a monitoring plan never falls into execution", () => {
    const start = runtime.indexOf("// ── A STANDING CONDITION: WATCH");
    const end = runtime.indexOf("// ── A PERSISTENT WORLD: MATERIALIZE");
    expect(runtime.slice(start, end)).toContain('routeDecision.route === "MONITORING"');
  });
});

// ── Both surfaces, one runtime ───────────────────────────────────────────────

describe("web and mobile read the same monitor", () => {
  it("call the same procedures by name", () => {
    const router = source("api/routers/runtime.ts");
    const mobile = source("../../../artifacts/jasim-mobile/lib/runtime-trpc.ts");
    for (const procedure of ["monitorList", "monitorRead", "monitorEvaluations", "monitorTransition"]) {
      expect(router, procedure).toContain(`${procedure}:`);
      expect(mobile, procedure).toContain(`runtime.${procedure}`);
    }
    // No monitor runtime on either side of the wire: neither surface DECLARES
    // one. (The mobile file says so in a comment, which is why this looks for
    // a declaration rather than the words.)
    for (const text of [source("src/components/jasim-core/PresentationRenderer.tsx"), mobile]) {
      expect(text).not.toMatch(/(class|function|const)\s+\w*MonitorRuntime/);
      expect(text).not.toMatch(/evaluateCondition|firesOn\(/);
    }
  });

  it("neither claims to be live", () => {
    //   NO FAKE «LIVE»
    const mobile = source("../../../artifacts/jasim-mobile/lib/runtime-trpc.ts");
    expect(mobile).toContain("never claims to be subscribed");
    const runtime = source("api/runtime/monitoring-runtime.ts");
    expect(runtime).toContain("live: false");
  });
});
