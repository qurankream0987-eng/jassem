/**
 * JASIM — GoalSpec: what should happen, checked before anyone asks how.
 *
 * The phase rule these tests enforce more than any other:
 *
 *     GOAL = WHAT SHOULD HAPPEN.      PLAN = HOW IT WILL HAPPEN.
 *
 * A GoalSpec that can name a step has stopped being a goal, so the last block
 * here fails if this module ever learns to.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GOAL_AUTHORITY_KEYS,
  GOAL_DIMENSIONS,
  GoalSpecSchema,
  evaluateGoalSpec,
  goalBlockerMessage,
  parseProposedGoalSpec,
  type GoalSpec,
} from "../../api/runtime/goal-spec";
import { AUTHORITY_KEYS, ModelOutputAuthorityError } from "../../api/runtime/model-output-trust";

const base = (over: Partial<GoalSpec> = {}): GoalSpec =>
  GoalSpecSchema.parse({
    version: 1,
    outcome: "ترتيب الموضوع",
    constraints: [],
    preferences: [],
    assumptions: [],
    unknowns: [],
    ...over,
  });

/** «رتب لي الموضوع بأرخص طريقة لكن لا تتأخر أكثر من يومين», typed. */
const THE_SENTENCE = (): GoalSpec =>
  base({
    outcome: "ترتيب الموضوع",
    constraints: [
      {
        dimension: "COST",
        operator: "MINIMIZE",
        hardness: "SOFT",
        source: "STATED",
        evidence: "بأرخص طريقة",
      },
      {
        dimension: "TIME",
        operator: "AT_MOST",
        value: 2,
        unit: "DAY",
        hardness: "HARD",
        source: "STATED",
        evidence: "لا تتأخر أكثر من يومين",
      },
    ],
    preferences: ["COST", "TIME"],
  });

describe("the sentence that had nowhere to live", () => {
  it("«أرخص» and «يومين» both have a typed home", () => {
    const evaluation = evaluateGoalSpec(THE_SENTENCE());
    expect(evaluation.readiness).toBe("ACTIONABLE");
    expect(evaluation.hardConstraints).toHaveLength(1);
    expect(evaluation.hardConstraints[0]).toMatchObject({
      dimension: "TIME",
      operator: "AT_MOST",
      value: 2,
      unit: "DAY",
    });
    expect(evaluation.softConstraints).toHaveLength(1);
    expect(evaluation.softConstraints[0]).toMatchObject({
      dimension: "COST",
      operator: "MINIMIZE",
    });
  });

  it("the deadline is a wall and the price is a direction — they are not the same field", () => {
    const evaluation = evaluateGoalSpec(THE_SENTENCE());
    // The whole point. Collapsing these is how «لا تتأخر أكثر من يومين»
    // becomes "we tried to be quick".
    expect(evaluation.hardConstraints.map((c) => c.dimension)).toEqual(["TIME"]);
    expect(evaluation.softConstraints.map((c) => c.dimension)).toEqual(["COST"]);
  });
});

describe("an inference may guide, it may not exclude", () => {
  const inferredHard = (): GoalSpec =>
    base({
      constraints: [
        {
          dimension: "TIME",
          operator: "AT_MOST",
          value: 1,
          unit: "DAY",
          hardness: "HARD",
          source: "INFERRED",
        },
      ],
    });

  it("an INFERRED constraint proposed as HARD is downgraded to SOFT", () => {
    const evaluation = evaluateGoalSpec(inferredHard());
    expect(evaluation.hardConstraints).toHaveLength(0);
    expect(evaluation.softConstraints).toHaveLength(1);
  });

  it("the downgrade is recorded, never silent", () => {
    const evaluation = evaluateGoalSpec(inferredHard());
    expect(evaluation.adjustments).toHaveLength(1);
    expect(evaluation.adjustments[0]).toMatchObject({
      code: "INFERRED_CONSTRAINT_DOWNGRADED",
      dimension: "TIME",
    });
  });

  it("a STATED HARD constraint is left alone", () => {
    const evaluation = evaluateGoalSpec(THE_SENTENCE());
    expect(evaluation.adjustments).toEqual([]);
    expect(evaluation.hardConstraints).toHaveLength(1);
  });

  it("the adjustment is never more permissive than proposed", () => {
    // Downgrade-only, like `applyCompletionDecision`. Nothing here may turn a
    // SOFT preference into a HARD wall.
    const proposed = base({
      constraints: [
        { dimension: "COST", operator: "MINIMIZE", hardness: "SOFT", source: "INFERRED" },
      ],
    });
    const evaluation = evaluateGoalSpec(proposed);
    expect(evaluation.hardConstraints).toHaveLength(0);
    expect(evaluation.adjustments).toEqual([]);
  });
});

describe("contradictions are found before anyone plans", () => {
  it("«خلال ساعة» and «بعد يومين على الأقل» cannot both hold", () => {
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "HOUR", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("UNSATISFIABLE");
    expect(evaluation.conflicts[0]).toMatchObject({
      code: "CONTRADICTORY_HARD_BOUNDS",
      dimension: "TIME",
    });
  });

  it("time units are normalised, so 48 HOUR and 2 DAY agree", () => {
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 48, unit: "HOUR", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("ACTIONABLE");
  });

  it("two EQUALS on one dimension that disagree is unsatisfiable", () => {
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "COST", operator: "EQUALS", value: 10, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "COST", operator: "EQUALS", value: 20, unit: "KWD", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("UNSATISFIABLE");
  });

  it("an EQUALS outside a stated range is unsatisfiable", () => {
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "COST", operator: "AT_MOST", value: 10, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "COST", operator: "EQUALS", value: 25, unit: "KWD", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("UNSATISFIABLE");
  });

  it("a narrower bound is redundant, not contradictory", () => {
    // Narrowing a requirement is the person's prerogative, not an error.
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "COST", operator: "AT_MOST", value: 10, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "COST", operator: "AT_MOST", value: 5, unit: "KWD", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("ACTIONABLE");
  });

  it("SOFT constraints never make a goal unsatisfiable", () => {
    // A direction cannot contradict a direction; only walls can collide.
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "HOUR", hardness: "SOFT", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "SOFT", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("ACTIONABLE");
  });

  it("two hard costs in different currencies are reported, not assumed compatible", () => {
    // Comparing them needs a rate. This module has no rate and will not invent
    // one, so it says so instead of passing the goal as satisfiable.
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "COST", operator: "AT_MOST", value: 10, unit: "KWD", hardness: "HARD", source: "STATED" },
          { dimension: "COST", operator: "AT_LEAST", value: 50, unit: "USD", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("UNSATISFIABLE");
    expect(evaluation.conflicts[0].code).toBe("INCOMPARABLE_HARD_BOUNDS");
  });

  it("an unrecognised time unit is not silently treated as seconds", () => {
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "FORTNIGHT", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("UNSATISFIABLE");
    expect(evaluation.conflicts[0].code).toBe("INCOMPARABLE_HARD_BOUNDS");
  });
});

describe("an open question blocks, and is not the same as impossible", () => {
  it("unknowns make a goal NEEDS_INPUT", () => {
    const evaluation = evaluateGoalSpec(base({ unknowns: ["إلى أي مدينة؟"] }));
    expect(evaluation.readiness).toBe("NEEDS_INPUT");
  });

  it("an unsatisfiable goal stays UNSATISFIABLE even with open questions", () => {
    // Sending somebody to answer a question that cannot help is its own lie.
    const evaluation = evaluateGoalSpec(
      base({
        unknowns: ["إلى أي مدينة؟"],
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "HOUR", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(evaluation.readiness).toBe("UNSATISFIABLE");
  });

  it("the blocker message names the question, and says nothing when there is none", () => {
    expect(goalBlockerMessage(evaluateGoalSpec(base({ unknowns: ["إلى أي مدينة؟"] })))).toContain(
      "إلى أي مدينة؟",
    );
    expect(goalBlockerMessage(evaluateGoalSpec(THE_SENTENCE()))).toBeUndefined();
  });

  it("the unsatisfiable message names the dimension that collided", () => {
    const evaluation = evaluateGoalSpec(
      base({
        constraints: [
          { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "HOUR", hardness: "HARD", source: "STATED" },
          { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
        ],
      }),
    );
    expect(goalBlockerMessage(evaluation)).toContain("TIME");
  });
});

describe("the shape is strict", () => {
  it("an unexpected key is rejected, not ignored", () => {
    expect(() =>
      parseProposedGoalSpec({ ...THE_SENTENCE(), chosenProvider: "acme" }),
    ).toThrow();
  });

  it("MINIMIZE carrying a value is rejected", () => {
    expect(() =>
      parseProposedGoalSpec(
        base({
          constraints: [
            { dimension: "COST", operator: "MINIMIZE", value: 5, unit: "KWD", hardness: "SOFT", source: "STATED" } as never,
          ],
        }),
      ),
    ).toThrow();
  });

  it("a bounded operator with no value is rejected", () => {
    expect(() =>
      parseProposedGoalSpec({
        version: 1,
        outcome: "x",
        constraints: [{ dimension: "COST", operator: "AT_MOST", hardness: "HARD", source: "STATED" }],
      }),
    ).toThrow();
  });

  it("a bare number with no unit is rejected", () => {
    // "at most 2" of what?
    expect(() =>
      parseProposedGoalSpec({
        version: 1,
        outcome: "x",
        constraints: [{ dimension: "TIME", operator: "AT_MOST", value: 2, hardness: "HARD", source: "STATED" }],
      }),
    ).toThrow();
  });

  it("an unknown dimension is rejected", () => {
    expect(() =>
      parseProposedGoalSpec({
        version: 1,
        outcome: "x",
        constraints: [
          { dimension: "DELIVERY_SPEED", operator: "MINIMIZE", hardness: "SOFT", source: "STATED" },
        ],
      }),
    ).toThrow();
  });

  it("a minimal goal needs only an outcome", () => {
    const parsed = parseProposedGoalSpec({ version: 1, outcome: "احجز موعداً" });
    expect(parsed.constraints).toEqual([]);
    expect(evaluateGoalSpec(parsed).readiness).toBe("ACTIONABLE");
  });
});

describe("a goal may not carry authority", () => {
  it.each([...GOAL_AUTHORITY_KEYS])("«%s» is rejected outright", (key) => {
    expect(() =>
      parseProposedGoalSpec({ version: 1, outcome: "x", [key]: true }),
    ).toThrow(ModelOutputAuthorityError);
  });

  it("every goal authority key is in the shared set", () => {
    // Two lists that can drift are one list nobody maintains.
    for (const key of GOAL_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS.has(key)).toBe(true);
    }
  });

  it("an authority claim nested inside a constraint is still rejected", () => {
    expect(() =>
      parseProposedGoalSpec({
        version: 1,
        outcome: "x",
        constraints: [
          {
            dimension: "COST",
            operator: "MINIMIZE",
            hardness: "SOFT",
            source: "STATED",
            constraintWaived: true,
          },
        ],
      }),
    ).toThrow(ModelOutputAuthorityError);
  });
});

describe("GOAL is not PLAN", () => {
  // The phase boundary, enforced rather than promised. If a later change adds a
  // step, a capability or an ordering to this module, one of these fails.
  const source = [
    evaluateGoalSpec.toString(),
    parseProposedGoalSpec.toString(),
    goalBlockerMessage.toString(),
  ].join("\n");

  it.each([
    "capability",
    "capabilities",
    "provider",
    "dependson",
    "dagnode",
    "executeplan",
    "steps",
    "nodekey",
  ])("the goal module says nothing about «%s»", (word) => {
    expect(source.toLowerCase()).not.toContain(word);
  });

  it("the schema has no field that could name a step", () => {
    const fields = Object.keys(GoalSpecSchema.shape);
    expect(fields.sort()).toEqual(
      ["assumptions", "constraints", "outcome", "preferences", "unknowns", "version"].sort(),
    );
  });

  it("the dimension list names no domain", () => {
    for (const dimension of GOAL_DIMENSIONS) {
      expect(dimension).not.toMatch(/DELIVERY|RIDE|FLIGHT|HOTEL|CAR|FOOD|SHOP|DRIVER/i);
    }
    expect(GOAL_DIMENSIONS).toHaveLength(6);
  });
});

describe("the gap this closed was real", () => {
  // The module header makes three checkable claims about the pre-GoalSpec
  // state. A header that stops being true is worse than no header.
  const runtime = readFileSync(
    join(__dirname, "../../api/runtime/jasim-runtime.ts"),
    "utf8",
  );

  it("the execution intent still has no constraint field of its own", () => {
    const schema = runtime.slice(
      runtime.indexOf("const EnvelopeExecutionIntentSchema"),
      runtime.indexOf("type EnvelopeExecutionIntent ="),
    );
    expect(schema).toContain("requiredCapabilities");
    expect(schema).toContain("inputs: z.record");
    // No typed home for a requirement — which is why GoalSpec exists beside it
    // rather than inside it.
    expect(schema).not.toMatch(/constraints\s*:/);
    expect(schema).not.toMatch(/hardness/);
  });

  it("free-form `inputs` still accepts anything, including a dropped deadline", () => {
    // This is the silent failure: the schema accepts it and nothing reads it.
    const accepted = z
      .record(z.string(), z.unknown())
      .safeParse({ deadline: "48h", maxCost: 10 });
    expect(accepted.success).toBe(true);
  });

  it("the runtime still does not import the dead prompt template", () => {
    // `api/core/capability-registry.ts` interpolates {{inputs.constraints}}
    // into an LLM prompt. The header calls it a prompt template rather than an
    // enforcement point because nothing on the runtime path imports it.
    expect(runtime).not.toContain("core/capability-registry");
  });

  it("goalSpec rides the existing envelope and stays optional", () => {
    // Optional matters: a model that omits it must keep working. Adding a
    // required field would have made every existing turn invalid.
    expect(runtime).toContain("goalSpec: GoalSpecSchema.optional()");
  });
});
