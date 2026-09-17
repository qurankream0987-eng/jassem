import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresentationRenderer } from "../../src/components/jasim-core/PresentationRenderer";
import {
  MOBILE_PRESENTATION_REGISTRY,
  resolveMobilePresentationPolicy,
} from "../../../../../artifacts/jasim-mobile/lib/mobile-presentation";
import { UI_SCENARIOS } from "./ui-scenarios";

/**
 * UI-1 Part 26 — before/after evidence.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT.
 *
 * It is the real component output for the real semantic states the decision
 * layer produces, captured identically before and after a change, so a claim
 * like "the approval surface got clearer" can be checked against a diff instead
 * of taken on trust.
 *
 * It is NOT a screenshot. This environment has no wired browser-driven capture
 * for this app and Metro cannot run here, so nothing in this file should be
 * described as visual evidence. Markup catches structure, text, semantics and
 * class names; it does not catch contrast, spacing or motion. The report says so.
 *
 * Usage:
 *   JASIM_UI_EVIDENCE=before npx vitest run tests/unit/ui-evolution-ui1.test.tsx
 *   JASIM_UI_EVIDENCE=after  npx vitest run tests/unit/ui-evolution-ui1.test.tsx
 */

const EVIDENCE_ROOT = path.resolve(__dirname, "../../../../../docs/ui/evidence");

/** Server-rendered markup for one scenario's web surface. */
export function webMarkup(scenarioIndex: number): string {
  const scenario = UI_SCENARIOS[scenarioIndex]!;
  return renderToStaticMarkup(
    React.createElement(PresentationRenderer, { presentation: scenario.presentation }),
  );
}

/**
 * The mobile side cannot be server-rendered the way the web side can — React
 * Native has no DOM. What IS comparable, and what actually decides what a user
 * sees, is the resolution step: which renderer kind a primitive maps to and
 * which fields survive. Capturing that keeps the mobile column honest rather
 * than empty.
 */
export function mobileResolution(scenarioIndex: number): string {
  const scenario = UI_SCENARIOS[scenarioIndex]!;
  const primitive = scenario.presentation.primitive;
  return JSON.stringify(
    {
      primitive,
      // What the mobile renderer will draw, and how it will be surfaced.
      registryKind: MOBILE_PRESENTATION_REGISTRY[primitive] ?? null,
      surfacePolicy: resolveMobilePresentationPolicy(scenario.presentation),
      actions: (scenario.presentation.actions ?? []).map((action) => action.intent),
      dataKeys: Object.keys(scenario.presentation.data ?? {}).sort(),
    },
    null,
    2,
  );
}

export function captureEvidence(phase: string): string {
  const outDir = path.join(EVIDENCE_ROOT, phase);
  mkdirSync(outDir, { recursive: true });

  const index: string[] = [
    `# JASIM UI evidence — \`${phase}\``,
    "",
    "Server-rendered component output for each canonical semantic scenario.",
    "Structure, text and semantics only — not a visual capture. See the UI-1 report.",
    "",
  ];

  UI_SCENARIOS.forEach((scenario, scenarioIndex) => {
    const web = webMarkup(scenarioIndex);
    const mobile = mobileResolution(scenarioIndex);
    writeFileSync(path.join(outDir, `${scenario.id}.web.html`), `${web}\n`, "utf8");
    writeFileSync(path.join(outDir, `${scenario.id}.mobile.json`), `${mobile}\n`, "utf8");
    index.push(
      `## ${scenario.id} — ${scenario.title}`,
      "",
      `**Primitive:** \`${scenario.presentation.primitive}\``,
      "",
      `**Expectation:** ${scenario.expectation}`,
      "",
      `- Web: [\`${scenario.id}.web.html\`](./${scenario.id}.web.html) — ${web.length} chars`,
      `- Mobile: [\`${scenario.id}.mobile.json\`](./${scenario.id}.mobile.json)`,
      "",
    );
  });

  const indexPath = path.join(outDir, "README.md");
  writeFileSync(indexPath, `${index.join("\n")}\n`, "utf8");
  return outDir;
}
