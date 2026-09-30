/**
 * IS JASIM WAITING FOR PROVIDERS, OR IS IT UNFINISHED?
 *
 * ─── WHY THIS IS A COMMAND AND NOT AN OPINION ───────────────────────────────
 *
 * «Everything is ready, it just needs providers» is the one claim about this
 * runtime that nobody should take on trust — least of all from whoever wrote
 * it. So it is a thing you run.
 *
 * Every provider-dependent boundary must give exactly ONE of two answers:
 *
 *   READY            — a credential is present, so this boundary will be used
 *   WAITING(name)    — no credential, and the code refuses BY NAME
 *
 * Any third answer is the failure this exists to find: a boundary that would
 * fake a result, swallow the absence, or crash instead of refusing.
 *
 *   MISSING PROVIDER != BROKEN RUNTIME — and a runtime that cannot tell you
 *   which one it is has not finished.
 *
 * What this does NOT do: call anybody's API, verify a key is valid, or say a
 * model would answer well. It reads configuration and reports what each
 * boundary will therefore do.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const has = (...names) => names.find((n) => (process.env[n] ?? "").trim().length > 0);

/**
 * Every boundary, what unlocks it, and what stops without it.
 * `gates` is the honest part: it says what the person loses while it waits.
 */
const BOUNDARIES = [
  {
    id: "model",
    label: "النموذج — فهم الكلام وتوليد الخطة والسطح",
    keys: ["JASIM_MODEL_PROVIDER+key", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY",
           "GEMINI_API_KEY", "MODEL_GATEWAY_API_KEY + MODEL_GATEWAY_BASE_URL"],
    check: () =>
      has("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "GEMINI_API_KEY") ??
      ((process.env.MODEL_GATEWAY_API_KEY && process.env.MODEL_GATEWAY_BASE_URL) ? "MODEL_GATEWAY_API_KEY" : undefined) ??
      ((process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) ? "AI_INTEGRATIONS_OPENAI_API_KEY" : undefined),
    gates: "كل دور محادثة. بدونه لا يبدأ شيء.",
    blocking: true,
  },
  { id: "notify.push", label: "إشعار — دفع", keys: ["FIREBASE_PROJECT_ID", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL"],
    check: () => (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) ? "FIREBASE_*" : undefined,
    gates: "تنبيه صاحب الطلب خارج التطبيق. داخل التطبيق يعمل بدونه." },
  { id: "notify.sms", label: "إشعار — رسالة نصية", keys: ["TWILIO_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    check: () => (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN) ? "TWILIO_*" : undefined,
    gates: "قناة نصية واحدة من أربع." },
  { id: "notify.whatsapp", label: "إشعار — واتساب", keys: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    check: () => (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) ? "WHATSAPP_*" : undefined,
    gates: "قناة واحدة من أربع." },
  { id: "notify.email", label: "إشعار — بريد", keys: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
    check: () => (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) ? "SENDGRID_*" : undefined,
    gates: "قناة واحدة من أربع." },
  { id: "storage", label: "تخزين الملفات والصور المولّدة", keys: ["S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "PRIVATE_OBJECT_DIR"],
    check: () => has("S3_BUCKET", "PRIVATE_OBJECT_DIR"),
    gates: "حفظ ما يُولَّد كملف. المحادثة لا تحتاجه." },
  { id: "search", label: "بحث الويب", keys: ["SEARCH_API_URL", "SEARCH_API_KEY"],
    check: () => (process.env.SEARCH_API_URL && process.env.SEARCH_API_KEY) ? "SEARCH_API_*" : undefined,
    gates: "الاكتشاف من خارج جاسم. الاكتشاف الداخلي يعمل بدونه." },
  { id: "sandbox", label: "صندوق تشغيل القدرات المعزول", keys: ["JASIM_CAPABILITY_SANDBOX_URL", "JASIM_CAPABILITY_SANDBOX_TOKEN"],
    check: () => (process.env.JASIM_CAPABILITY_SANDBOX_URL && process.env.JASIM_CAPABILITY_SANDBOX_TOKEN) ? "JASIM_CAPABILITY_SANDBOX_*" : undefined,
    gates: "تشغيل قدرة خارجية موقّعة. القدرات المدمجة تعمل بدونه." },
];

/** What must exist for JASIM to run at all, provider or no provider. */
const FOUNDATION = [
  { id: "database", label: "قاعدة البيانات", keys: ["DATABASE_URL"], check: () => has("DATABASE_URL"), blocking: true },
  { id: "session", label: "سرّ الجلسات", keys: ["SESSION_SECRET"], check: () => has("SESSION_SECRET"), blocking: true },
];

export function readiness() {
  const rows = [...FOUNDATION, ...BOUNDARIES].map((b) => {
    const via = b.check();
    return { ...b, ready: Boolean(via), via: via ?? null };
  });
  const blockers = rows.filter((r) => r.blocking && !r.ready);
  return { rows, blockers };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rows, blockers } = readiness();
  const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].length));
  console.log("\nJASIM — جاهزية المزوّدات\n" + "─".repeat(78));
  for (const row of rows) {
    const mark = row.ready ? "READY  " : (row.blocking ? "BLOCKS " : "WAITING");
    console.log(`${mark} ${pad(row.id, 18)} ${row.label}`);
    if (row.ready) console.log(`        ↳ عبر ${row.via}`);
    else {
      console.log(`        ↳ يحتاج أحد: ${row.keys.join("  |  ")}`);
      if (row.gates) console.log(`        ↳ وبدونه يتوقّف: ${row.gates}`);
    }
  }
  console.log("─".repeat(78));
  if (blockers.length === 0) {
    console.log("لا شيء يمنع التشغيل. كل ما هو WAITING يتوقّف بالاسم، لا بالصمت.\n");
    process.exit(0);
  }
  console.log(`يمنع التشغيل: ${blockers.map((b) => b.id).join(", ")}\n`);
  process.exit(1);
}
