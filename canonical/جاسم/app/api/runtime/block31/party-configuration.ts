/**
 * WHAT A PARTY MAY STATE, AND WHAT THEY MAY NOT.
 *
 *   OFFERING_PUBLIC_TERMS != PARTY_STATED_CONFIGURATION
 *   PARTY_CONFIGURATION   != COUNTERPARTY_CHANGED_TERMS
 *   CONFIGURATION         != NEGOTIATION
 *
 * An offering may PUBLISH which of its terms are open to the other party, and
 * within what bounds. A party may then state values for exactly those terms,
 * and for nothing else. Stating a value is not negotiating: it cannot widen
 * what the offering permits, it cannot touch the published offering, and it
 * cannot introduce a term the offering never opened.
 *
 * There is no vocabulary of options here. A declaration is a key, a kind and a
 * bound — the same three things whether what is being configured is a
 * preparation, an hour of somebody's time, a machine's tolerance or a room.
 *
 *   DOMAIN_CONFIGURATION_TYPES_ADDED = 0
 */

import { createHash } from "node:crypto";

/** The kinds a configurable term may take. The same two the term sheet uses. */
export const CONFIGURABLE_KINDS = ["CHOICE", "NUMBER"] as const;
export type ConfigurableKind = (typeof CONFIGURABLE_KINDS)[number];

/**
 * ONE declaration shape.
 *
 * `allowed` bounds a CHOICE; `min`/`max` bound a NUMBER. A declaration that
 * bounds nothing is still a declaration — it says the term is open — but an
 * undeclared key is closed, which is the direction that matters.
 */
export type ConfigurableTerm = {
  readonly key: string;
  readonly kind: ConfigurableKind;
  readonly allowed?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
};

export class ConfigurationError extends Error {
  readonly code: "NOT_CONFIGURABLE" | "OUT_OF_BOUNDS" | "WRONG_KIND" | "INVALID";
  readonly key: string | undefined;
  constructor(message: string, code: ConfigurationError["code"], key?: string) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.key = key;
  }
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/i;
const MAX_CONFIGURABLE_TERMS = 40;

/**
 * Read an offering's declaration.
 *
 * An offering that declares nothing is not broken — it is an offering whose
 * terms are fixed, which is the safe default and the common case.
 */
export function configurableTermsOf(publicProjection: unknown): readonly ConfigurableTerm[] {
  const projection =
    publicProjection && typeof publicProjection === "object" && !Array.isArray(publicProjection)
      ? (publicProjection as Record<string, unknown>)
      : {};
  const declared = projection.configurableTerms;
  if (!Array.isArray(declared)) return [];
  if (declared.length > MAX_CONFIGURABLE_TERMS) {
    throw new ConfigurationError("هذا العرض يعلن شروطاً قابلة للضبط أكثر مما أقبل.", "INVALID");
  }
  const terms: ConfigurableTerm[] = [];
  const seen = new Set<string>();
  for (const raw of declared) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (!KEY_PATTERN.test(key) || seen.has(key)) continue;
    const kind = String(entry.kind ?? "").toUpperCase();
    if (!CONFIGURABLE_KINDS.includes(kind as ConfigurableKind)) continue;
    seen.add(key);
    terms.push({
      key,
      kind: kind as ConfigurableKind,
      ...(Array.isArray(entry.allowed)
        ? { allowed: entry.allowed.filter((v): v is string => typeof v === "string") }
        : {}),
      ...(typeof entry.min === "number" && Number.isFinite(entry.min) ? { min: entry.min } : {}),
      ...(typeof entry.max === "number" && Number.isFinite(entry.max) ? { max: entry.max } : {}),
      ...(typeof entry.unit === "string" && entry.unit.trim() ? { unit: entry.unit.trim() } : {}),
    });
  }
  return Object.freeze(terms);
}

/**
 * Validate what a party stated against what the offering opened.
 *
 * Every refusal names the key and the reason, because «that is not
 * configurable» and «that is outside what is offered» are different facts and
 * a person deciding what to do next needs to know which one they hit.
 *
 * The offering row is READ here and never written. Configuring is something a
 * party does to their own draft; it is not something they do to somebody
 * else's published offering.
 */
export function validateConfiguration(
  stated: Record<string, unknown>,
  declared: readonly ConfigurableTerm[],
): Record<string, string | number> {
  const byKey = new Map(declared.map((term) => [term.key, term]));
  const accepted: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(stated)) {
    const term = byKey.get(key);
    // The direction that matters: an UNDECLARED key is closed. A party cannot
    // widen an offering by naming a term it never opened.
    if (!term) {
      throw new ConfigurationError(
        `«${key}» ليس مما يتركه هذا العرض مفتوحاً.`,
        "NOT_CONFIGURABLE",
        key,
      );
    }
    if (term.kind === "NUMBER") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConfigurationError(`«${key}» يأخذ رقماً.`, "WRONG_KIND", key);
      }
      if (term.min !== undefined && value < term.min) {
        throw new ConfigurationError(`«${key}» أدنى مما يعرضه.`, "OUT_OF_BOUNDS", key);
      }
      if (term.max !== undefined && value > term.max) {
        throw new ConfigurationError(`«${key}» أعلى مما يعرضه.`, "OUT_OF_BOUNDS", key);
      }
      accepted[key] = value;
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new ConfigurationError(`«${key}» يأخذ قيمة.`, "WRONG_KIND", key);
    }
    const choice = value.trim();
    if (term.allowed && !term.allowed.includes(choice)) {
      throw new ConfigurationError(
        `«${key}» ليس من القيم التي لا يسمح هذا العرض بغيرها.`,
        "OUT_OF_BOUNDS",
        key,
      );
    }
    accepted[key] = choice;
  }
  return accepted;
}

/**
 * A fingerprint over CANONICAL STATE, never over a display string.
 *
 * Keys are sorted so that two configurations differing only in the order
 * somebody typed them are the same configuration, which is what makes
 * «unchanged configuration» idempotent rather than accidental.
 */
export function configurationFingerprint(configuration: Record<string, unknown>): string {
  const canonical = Object.keys(configuration)
    .sort()
    .map((key) => [key, configuration[key]] as const);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * The terms a proposal actually carries: what the offering published, with
 * what this party stated laid over the keys the offering opened.
 *
 * Validation has already refused anything undeclared, so this merge cannot
 * introduce a term the offering never opened — the merge is a merge, not a
 * second place where permission is decided.
 */
export function mergedProposalTerms(
  offeringTerms: Record<string, unknown>,
  configuration: Record<string, string | number>,
): Record<string, unknown> {
  return { ...offeringTerms, ...configuration };
}
