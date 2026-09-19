/**
 * JASIM — recognising the SHAPE of a secret, without ever holding one.
 *
 * ─── WHAT THIS IS FOR, AND WHAT IT IS NOT ───────────────────────────────────
 *
 * Wave 1 made conversation titles derive from the first user message. That
 * created a SECOND place a credential lands if somebody pastes one into the
 * chat box: the message row, and now the title row. This module exists to
 * close that second place.
 *
 * It does NOT solve credential ingestion. The message itself is still stored
 * and still reaches the model — that is the pre-existing behaviour, and the
 * rule that fixes it belongs to the Conversation-First secure-auth phase:
 *
 *     credentials bypass LLM context and normal conversation persistence.
 *
 * Nothing here should be cited as evidence that the broader rule holds. See
 * `docs/architecture/00F_JASIM_CONVERSATION_FIRST_INTERACTION_LAW.md` §3.
 *
 * ─── IT RETURNS A CLASSIFICATION, NEVER THE MATCH ───────────────────────────
 *
 * Every function here returns a shape name or a boolean. None of them returns,
 * captures into a variable that outlives the call, or accepts a callback that
 * could receive, the matched text. That is deliberate: a detector that hands
 * back "the secret I found" is one careless log line away from being the leak
 * it was written to prevent.
 *
 * ─── SHAPES, NOT DOMAINS, AND NOT TOPICS ────────────────────────────────────
 *
 * «كيف أغير كلمة المرور؟» is a question about passwords. It contains no
 * password, and titling it «محادثة خاصة» would hide an ordinary conversation
 * behind a privacy label for no gain. So a label only counts when a VALUE
 * follows it. The word is not the secret.
 */

/** What was recognised. The value itself is never part of this. */
export type CredentialShape =
  /** `password: …`, `كلمة المرور: …`, `otp 483920` — a label with a value. */
  | "LABELLED_SECRET"
  /** `Authorization: Bearer …`, or a bare `Bearer …`. */
  | "AUTHORIZATION_HEADER"
  /** A provider's own key prefix: `sk-`, `ghp_`, `AKIA…`, and friends. */
  | "KNOWN_KEY_PREFIX"
  /** Three base64url segments after an `eyJ` header. */
  | "JWT"
  /** A PEM private-key armour line. */
  | "PRIVATE_KEY_BLOCK"
  /** A long, mixed-case, high-variety opaque run with no ordinary meaning. */
  | "OPAQUE_HIGH_ENTROPY";

/**
 * Words that introduce a secret, in both languages.
 *
 * Kept as label→value pairs rather than bare words precisely because the bare
 * word is not the secret.
 */
const SECRET_LABELS = [
  "password",
  "passwd",
  "passphrase",
  "passcode",
  "secret",
  "api[\\s_-]?key",
  "apikey",
  "access[\\s_-]?token",
  "refresh[\\s_-]?token",
  "auth[\\s_-]?token",
  "id[\\s_-]?token",
  "session[\\s_-]?token",
  "client[\\s_-]?secret",
  "private[\\s_-]?key",
  "credential",
  "otp",
  "2fa",
  "mfa",
  "pin",
  "cvv",
  "cvc",
  "seed[\\s_-]?phrase",
  "mnemonic",
  "كلمة\\s*(?:ال)?(?:مرور|السر)",
  "كلمه\\s*(?:ال)?(?:مرور|السر)",
  "الرقم\\s*السري",
  "رمز\\s*(?:ال)?(?:تحقق|التفعيل|الدخول|المرور|الأمان|الامان)",
  "مفتاح\\s*(?:ال)?(?:api|واجهة|الوصول|سري)",
  "رمز\\s*سري",
  "كود\\s*(?:ال)?تحقق",
].join("|");

/**
 * A label, a separator, then something that could be a value.
 *
 * The separator is required. «كلمة المرور» on its own is a topic; «كلمة
 * المرور: hunter2» is a disclosure. The value must be at least four
 * non-space characters, which rules out «password: ?» and «otp: ».
 *
 * `هي` / `is` / `=` / `:` are the separators people actually use. A bare space
 * is accepted too — «otp 483920» is how a person writes it — but then the
 * value must look like a value rather than the next word of a sentence, so
 * that branch demands digits or a non-word character.
 */
const LABELLED_WITH_SEPARATOR = new RegExp(
  `(?:${SECRET_LABELS})\\s*(?:هي|هو|is|are)?\\s*[:=]\\s*\\S{4,}`,
  "iu",
);

const LABELLED_WITH_SPACE = new RegExp(
  `(?:${SECRET_LABELS})\\s+(?:هي|هو|is|are)?\\s*(?=\\S{4,})(?=\\S*\\d)\\S{4,}`,
  "iu",
);

const AUTHORIZATION_HEADER =
  /(?:authorization\s*:\s*\S+|\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,})/iu;

/**
 * Provider key prefixes.
 *
 * A prefix is strong evidence on its own — these strings do not occur in
 * ordinary prose, so no separator or label is needed.
 */
const KNOWN_KEY_PREFIX = new RegExp(
  [
    "sk-[A-Za-z0-9_-]{16,}",
    "sk_(?:live|test)_[A-Za-z0-9]{12,}",
    "pk_(?:live|test)_[A-Za-z0-9]{12,}",
    "rk_(?:live|test)_[A-Za-z0-9]{12,}",
    "gsk_[A-Za-z0-9]{20,}",
    "ghp_[A-Za-z0-9]{20,}",
    "gho_[A-Za-z0-9]{20,}",
    "ghs_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "glpat-[A-Za-z0-9_-]{16,}",
    "xox[abprs]-[A-Za-z0-9-]{10,}",
    "AKIA[0-9A-Z]{12,}",
    "ASIA[0-9A-Z]{12,}",
    "AIza[0-9A-Za-z_-]{30,}",
    "SG\\.[A-Za-z0-9_-]{16,}",
    "npm_[A-Za-z0-9]{20,}",
    "dop_v1_[a-f0-9]{32,}",
    "shpat_[a-fA-F0-9]{20,}",
    "hf_[A-Za-z0-9]{20,}",
    "AC[a-f0-9]{30,}",
  ].join("|"),
  "u",
);

/** A JWT: `eyJ` header, then two more base64url segments. */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u;

const PRIVATE_KEY_BLOCK = /-----BEGIN[A-Z ]*PRIVATE KEY-----/u;

/** Spans to ignore in the entropy heuristic only — see `hasOpaqueRun`. */
const URL_SPAN = /\bhttps?:\/\/\S+/giu;

/** The smallest opaque run treated as credential-like on shape alone. */
const OPAQUE_MIN_LENGTH = 28;

/** How many distinct characters a run must use before it looks generated. */
const OPAQUE_MIN_VARIETY = 12;

/**
 * A long generated-looking run: mixed case, digits, and real variety.
 *
 * This is the imprecise rule, so it is also the strictest. Mixed case is
 * required, which excludes hex digests and Arabic text; digits are required,
 * which excludes long words and identifiers; and the run must use at least
 * twelve distinct characters, which excludes `aaaaAAAA1111…` and repeated
 * padding.
 *
 * URLs are removed first. A long link is not a secret, and a person sharing
 * one should not have their conversation renamed «محادثة خاصة» for it. A token
 * carried INSIDE a URL therefore escapes this heuristic — but not the precise
 * rules above, which run against the unmodified text. The boundary is stated
 * rather than hidden: this rule trades that case for not mislabelling links.
 */
function hasOpaqueRun(text: string): boolean {
  const withoutUrls = text.replace(URL_SPAN, " ");
  for (const match of withoutUrls.matchAll(/[A-Za-z0-9_\-+/=.]{28,}/gu)) {
    const run = match[0];
    if (run.length < OPAQUE_MIN_LENGTH) continue;
    if (!/[a-z]/u.test(run)) continue;
    if (!/[A-Z]/u.test(run)) continue;
    if (!/\d/u.test(run)) continue;
    if (new Set(run).size < OPAQUE_MIN_VARIETY) continue;
    return true;
  }
  return false;
}

/**
 * The shape of the first credential-like thing in the text, or `null`.
 *
 * Order is most-precise-first, so the reported shape is the most specific one
 * that fits. The matched text is never returned, and never will be.
 */
export function credentialShapeIn(text: string): CredentialShape | null {
  if (typeof text !== "string" || !text) return null;
  if (PRIVATE_KEY_BLOCK.test(text)) return "PRIVATE_KEY_BLOCK";
  if (JWT.test(text)) return "JWT";
  if (KNOWN_KEY_PREFIX.test(text)) return "KNOWN_KEY_PREFIX";
  if (AUTHORIZATION_HEADER.test(text)) return "AUTHORIZATION_HEADER";
  if (LABELLED_WITH_SEPARATOR.test(text) || LABELLED_WITH_SPACE.test(text)) {
    return "LABELLED_SECRET";
  }
  if (hasOpaqueRun(text)) return "OPAQUE_HIGH_ENTROPY";
  return null;
}

/** Whether the text carries anything credential-shaped. */
export function containsCredentialShape(text: string): boolean {
  return credentialShapeIn(text) !== null;
}
