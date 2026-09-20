/**
 * Rendering the catalog into the document, so the two can never drift.
 *
 * Only the region between the markers is generated. Everything around it — the
 * law, the explanations, the reasoning — is written by hand and must stay
 * that way: a document that is entirely generated stops being read.
 */

import {
  GATES,
  GATE_STATUSES,
  SCENARIOS,
  scoreboard,
  type Gate,
  type Scenario,
} from "./catalog";

export const BEGIN = "<!-- BEGIN GENERATED: do not edit by hand -->";
export const END = "<!-- END GENERATED -->";

function scoreboardTable(): string {
  const board = scoreboard();
  const header = `| gate | ${GATE_STATUSES.join(" | ")} |`;
  const divider = `|---|${GATE_STATUSES.map(() => "---:").join("|")}|`;
  const rows = GATES.map((gate) => {
    const counts = board.gates[gate];
    return `| **${gate}** | ${GATE_STATUSES.map((status) => counts[status]).join(" | ")} |`;
  });
  return [header, divider, ...rows].join("\n");
}

function scenarioTable(scenarios: readonly Scenario[]): string {
  const header = "| id | goal | route | " + GATES.map((g) => g.slice(0, 4)).join(" | ") + " | blocker |";
  const divider = `|---|---|---|${GATES.map(() => ":-:").join("|")}|---|`;
  const short = (gate: Gate, scenario: Scenario) => {
    const status = scenario.gates[gate];
    if (status === "PASS") return "●";
    if (status === "NOT_APPLICABLE") return "—";
    if (status === "BLOCKED_BY_PROVIDER") return "P";
    if (status === "BLOCKED_BY_ENVIRONMENT") return "E";
    return "○";
  };
  const rows = scenarios.map(
    (scenario) =>
      `| \`${scenario.id}\` | ${scenario.goal} | ${scenario.route} | ` +
      GATES.map((gate) => short(gate, scenario)).join(" | ") +
      ` | ${scenario.currentBlocker ?? "—"} |`,
  );
  return [header, divider, ...rows].join("\n");
}

export function renderGenerated(): string {
  const board = scoreboard();
  const families = [...new Set(SCENARIOS.map((scenario) => scenario.family))];
  const sections = families.map((family) => {
    const inFamily = SCENARIOS.filter((scenario) => scenario.family === family);
    return `### ${family} · ${inFamily.length}\n\n${scenarioTable(inFamily)}`;
  });

  return [
    BEGIN,
    "",
    "## Scoreboard",
    "",
    `**TOTAL_SCENARIOS = ${board.totalScenarios}** · holdouts = ${board.holdouts}`,
    "",
    "Counted per gate. There is deliberately no single percentage: eight gates",
    "answer eight questions, and one number answering all of them is the exact",
    "claim this catalog exists to prevent.",
    "",
    scoreboardTable(),
    "",
    `Scenarios blocked by an absent **provider**: **${board.blockedByProvider}**`,
    `Scenarios blocked by this **environment**: **${board.blockedByEnvironment}**`,
    `Scenarios waiting on a **general capability**: **${board.notYetImplemented}**`,
    "",
    "### General gaps",
    "",
    "Each of these closes many scenarios at once. That is what makes it general.",
    "",
    ...board.generalGaps.map((gap) => `- \`${gap}\``),
    "",
    `### Ratchets`,
    "",
    `- \`DOMAIN_BRANCHES_REQUIRED = ${board.domainBranchesRequired}\``,
    `- \`BLIND_HOLDOUT_SCENARIOS = ${board.holdouts}\``,
    `- \`BLIND_HOLDOUT_REQUIRING_DOMAIN_BRANCH = ${board.holdoutsRequiringDomainBranch}\``,
    "",
    "## Scenarios",
    "",
    "● PASS · ○ general capability missing · P blocked by provider · E blocked by environment · — not applicable",
    "",
    ...sections.flatMap((section) => [section, ""]),
    END,
  ].join("\n");
}

/** Replace the generated region of a document, leaving the prose untouched. */
export function withGenerated(document: string, generated: string): string {
  const start = document.indexOf(BEGIN);
  const end = document.indexOf(END);
  if (start < 0 || end < 0) throw new Error("The document has no generated region.");
  return document.slice(0, start) + generated + document.slice(end + END.length);
}
