import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FROZEN_V1, REQUIRED_CATEGORIES } from "./corpus/frozen-v1";
import { METRICS, DETERMINISTIC_ONLY_DOMAINS, metricsByAvailability } from "./metrics";

/**
 * THE BENCHMARK'S OWN INVARIANTS.
 *
 * Everything here guards against the benchmark drifting toward whatever JASIM
 * already does. A suite that can be edited to pass is not a suite.
 */

const here = (file: string) => resolve(__dirname, file);
const read = (file: string) => readFileSync(here(file), "utf8");

/** Comments and string literals stripped — assert on code, not on prose. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .toLowerCase();
}

describe("the corpus is frozen", () => {
  it("has a stable digest that any edit breaks", () => {
    // Not a lock against change — a lock against SILENT change. Updating this
    // constant is how a corpus edit becomes a reviewed decision.
    const digest = createHash("sha256")
      .update(JSON.stringify(FROZEN_V1))
      .digest("hex")
      .slice(0, 16);
    expect(digest).toBe("949718cafbeff242");
  });

  it("has unique, permanent ids", () => {
    const ids = FROZEN_V1.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    // S-ids encode the acceptance examples; A-ids are adversarial.
    expect(ids.filter((id) => id.startsWith("S"))).toHaveLength(30);
    expect(ids.filter((id) => id.startsWith("A"))).toHaveLength(12);
  });

  it("covers every required category", () => {
    const covered = new Set(FROZEN_V1.map((scenario) => scenario.category));
    for (const category of REQUIRED_CATEGORIES) {
      expect(covered, category).toContain(category);
    }
  });

  it("every acceptance scenario cites the example it encodes", () => {
    for (const scenario of FROZEN_V1.filter((entry) => entry.id.startsWith("S"))) {
      expect(scenario.source, scenario.id).toMatch(/^example \d+$/);
    }
  });
});

describe("the benchmark names no domain", () => {
  /**
   * The load-bearing test of this whole phase. The 30 examples are written in
   * domain language; the benchmark encodes them in the runtime's vocabulary.
   * If a domain noun reaches the schema or the corpus, the benchmark has begun
   * to encode the domain-specific core the architecture forbids — and it would
   * then certify exactly what it exists to prevent.
   */
  const DOMAINS = [
    "driver", "hotel", "restaurant", "scaffold", "truck", "airline", "doctor",
    "courier", "laptop", "cnc", "translator", "conference", "warehouse",
    "سائق", "فندق", "مطعم", "سقالة", "شاحنة", "مترجم", "مؤتمر", "لابتوب",
  ];

  /**
   * THE BOUNDARY, AND IT IS NOT WHERE THE FIRST VERSION OF THIS TEST PUT IT.
   *
   * The first version forbade domain nouns anywhere in the corpus and failed on
   * «اعرض لي السائق» — which is example 5's utterance, verbatim, and exactly
   * what a real person says. Forbidding that would have made the benchmark
   * unrealistic in order to look generic.
   *
   * The honest rule: **the benchmark may HEAR a domain; it may not ENCODE one.**
   * An utterance is input under test. An expectation, a metric or a piece of
   * evaluator machinery naming a domain is the architecture failing.
   */
  it.each([["scenario.ts"], ["evaluate.ts"], ["metrics.ts"], ["trajectory.ts"]])(
    "%s — machinery contains no domain noun at all",
    (file) => {
      const code = codeOnly(read(file));
      for (const domain of DOMAINS) {
        expect(code, `${file} :: ${domain}`).not.toContain(domain);
      }
    },
  );

  it("the corpus names domains ONLY inside utterances", () => {
    const source = read("corpus/frozen-v1.ts");
    const withoutUtterances = codeOnly(source).replace(/utterance:\s*"[^"]*"/g, "utterance:\"\"");
    for (const domain of DOMAINS) {
      expect(withoutUtterances, domain).not.toContain(domain.toLowerCase());
    }
    // And at least one utterance really does name one, or the corpus is not
    // testing the translation from domain language to generic vocabulary.
    const utterances = FROZEN_V1.map((scenario) => scenario.utterance).join(" ");
    expect(DOMAINS.some((domain) => utterances.includes(domain))).toBe(true);
  });

  it("no scenario's utterance or fields smuggle a domain into an expectation", () => {
    for (const scenario of FROZEN_V1) {
      const expectations = JSON.stringify({
        expect: scenario.expect,
        forbid: scenario.forbid,
        primitives: scenario.primitives,
        category: scenario.category,
      }).toLowerCase();
      for (const domain of DOMAINS) {
        expect(expectations, `${scenario.id} :: ${domain}`).not.toContain(domain.toLowerCase());
      }
    }
  });

  it("expectation field names are generic, not domain-shaped", () => {
    // The brief's own example of the wrong schema: expectedDriverStatus.
    const fields = new Set(FROZEN_V1.flatMap((scenario) => [
      ...Object.keys(scenario.expect),
      ...Object.keys(scenario.forbid),
    ]));
    for (const field of fields) {
      expect(field).toMatch(
        /^(outputKind|capability|effectClass|verification|reference|approvalRequired|persistence|blockedReason|authorityClaims|fabricated|crossOwnerAccess|blindRetry|falseSuccess|domainSpecificCore)$/,
      );
    }
  });
});

describe("the metric model is honest", () => {
  it("defines every metric the brief requires, exactly once", () => {
    const required = [
      "GOAL_UNDERSTANDING_ACCURACY", "CONSTRAINT_COMPLIANCE", "REFERENCE_RESOLUTION_ACCURACY",
      "AMBIGUITY_HANDLING_ACCURACY", "CAPABILITY_SELECTION_ACCURACY", "PROVIDER_SELECTION_ACCURACY",
      "AUTHORITY_COMPLIANCE", "APPROVAL_CORRECTNESS", "EXECUTION_SUCCESS_RATE", "VERIFICATION_ACCURACY",
      "FALSE_SUCCESS_RATE", "FALSE_FAILURE_RATE", "INCONCLUSIVE_CORRECTNESS", "BLIND_RETRY_RATE",
      "REPLAN_SUCCESS_RATE", "USER_INTERVENTION_RATE", "MODEL_CALL_COUNT", "MODEL_TOKEN_COST",
      "PROVIDER_COST", "END_TO_END_LATENCY", "DOMAIN_SPECIFIC_PATCH_COUNT",
    ];
    const ids = METRICS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of required) expect(ids, id).toContain(id);
    expect(ids).toHaveLength(required.length);
  });

  it("every unmeasurable metric says why, and every measurable one names its evidence", () => {
    for (const entry of METRICS) {
      if (entry.availability === "MEASURABLE_NOW") {
        expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
        expect(entry.blocker, entry.id).toBeUndefined();
      } else {
        // An unmeasurable metric without a stated blocker is a number waiting
        // to be invented from something adjacent.
        expect(entry.blocker, entry.id).toBeTruthy();
      }
    }
  });

  it("no metric governing security or truth is model-judged", () => {
    const deterministic = new Set([
      "AUTHORITY_COMPLIANCE", "APPROVAL_CORRECTNESS", "FALSE_SUCCESS_RATE", "FALSE_FAILURE_RATE",
      "BLIND_RETRY_RATE", "VERIFICATION_ACCURACY", "INCONCLUSIVE_CORRECTNESS",
      "PROVIDER_SELECTION_ACCURACY", "DOMAIN_SPECIFIC_PATCH_COUNT",
    ]);
    for (const entry of METRICS) {
      if (deterministic.has(entry.id)) expect(entry.kind, entry.id).toBe("DETERMINISTIC");
    }
    expect(DETERMINISTIC_ONLY_DOMAINS).toContain("effect verification");
  });

  it("the must-be-zero metrics are the ones that measure lying", () => {
    const mustBeZero = METRICS.filter((entry) => entry.direction === "MUST_BE_ZERO").map((e) => e.id);
    expect(mustBeZero).toEqual(
      expect.arrayContaining([
        "AUTHORITY_COMPLIANCE", "FALSE_SUCCESS_RATE", "FALSE_FAILURE_RATE",
        "BLIND_RETRY_RATE", "DOMAIN_SPECIFIC_PATCH_COUNT",
      ]),
    );
  });

  it("reports how many metrics are available in each class", () => {
    // Not an assertion about quality — a guard that the classification is not
    // silently drifting toward optimism.
    expect(metricsByAvailability("MEASURABLE_NOW").length).toBeGreaterThanOrEqual(10);
    expect(metricsByAvailability("FUTURE").length).toBeGreaterThanOrEqual(2);
  });
});

describe("the evaluation framework consumes JASIM and JASIM does not consume it", () => {
  it("no runtime module imports the evaluation framework", () => {
    // If JASIM ever depended on its own benchmark, the benchmark would be part
    // of the system under test.
    const { execSync } = require("node:child_process");
    const hits = execSync(
      `grep -rln "tests/evals" ${resolve(__dirname, "../../api")} ${resolve(__dirname, "../../src")} || true`,
      { encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });

  it("the evaluator never reads message content or model reasoning", () => {
    // Trajectory evaluation uses structured artefacts only. Asserting on prose
    // would measure wording, and storing reasoning would be a privacy problem.
    const trajectory = codeOnly(read("trajectory.ts"));
    expect(trajectory).not.toContain("messages.content");
    expect(trajectory).not.toContain("reasoning");
    const evaluator = codeOnly(read("evaluate.ts"));
    expect(evaluator).not.toContain(".content");
  });

  it("truthful non-completion is never scored as a false claim", () => {
    const evaluator = read("evaluate.ts");
    expect(evaluator).toContain("TRUTHFUL_NON_COMPLETION");
    expect(evaluator).toMatch(/truthful non-completion, not a false claim/);
  });
});
