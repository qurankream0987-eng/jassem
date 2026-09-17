/**
 * JASIM — runtime states, said in Arabic, without lying.
 *
 * The runtime speaks in codes: `MODEL_GATEWAY_UNAVAILABLE`, `BLOCKED_BY_PROVIDER`,
 * `INCONCLUSIVE`, `STALE`. Showing those to a person is unhelpful; replacing
 * them with "حدث خطأ ما" is worse, because it throws away the one piece of
 * information that would have told them whether to wait, to act, or to give up.
 *
 * So each state gets three things:
 *
 *   `label`   — what happened, in a few words.
 *   `guidance`— what, if anything, the person can do about it. Absent when
 *               there is genuinely nothing; an invented suggestion is a lie
 *               with a friendly voice.
 *   `tone`    — how it should look, drawn from the semantic status tokens.
 *
 * THE RULE THAT MATTERS: `tone` is never `success` for a state that is not a
 * success. Part 19 exists because the previous UI stamped a green "Verified"
 * chip on a provider-unavailable surface. A blocked operation is `blocked`,
 * never `warning` and never `neutral` — it reads as an orange stop, not as a
 * yellow "careful" or a grey shrug.
 *
 * `icon` is the non-colour half of every status. A person who cannot
 * distinguish the hues, or who is reading a greyscale screenshot, still gets
 * the state from the glyph and the words. Nothing here is encoded by colour
 * alone.
 */

export type RuntimeStateTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "blocked"
  | "stale"
  | "working";

export type RuntimeStateCopy = {
  label: string;
  guidance?: string;
  tone: RuntimeStateTone;
  /** A short, stable glyph name — the colour-independent signal. */
  icon: "info" | "check" | "alert" | "stop" | "clock" | "spinner" | "question";
};

/**
 * Terminal and blocking states.
 *
 * Keys are the runtime's own vocabulary so a new code shows up as a missing
 * entry rather than as a wrong message.
 */
export const RUNTIME_STATE_COPY: Record<string, RuntimeStateCopy> = {
  MODEL_GATEWAY_UNAVAILABLE: {
    label: "تعذّر الوصول إلى نموذج الذكاء",
    guidance: "لم يُحفَظ شيء. يمكنك إعادة المحاولة بعد قليل.",
    tone: "blocked",
    icon: "stop",
  },
  MODEL_GATEWAY_INVALID_OUTPUT: {
    label: "وصل ردّ غير مكتمل من النموذج",
    guidance: "لم يُحفَظ شيء. أعد صياغة الطلب أو أعد المحاولة.",
    tone: "warning",
    icon: "alert",
  },
  MODEL_BUDGET_EXCEEDED: {
    label: "بلغ هذا الطلب حدّه المسموح من استدعاءات النموذج",
    guidance: "لم يُنفَّذ استدعاء إضافي. ابدأ طلبًا جديدًا للمتابعة.",
    tone: "blocked",
    icon: "stop",
  },
  MODEL_CONTEXT_TOO_LARGE: {
    label: "السياق أكبر من أن يُرسَل كاملًا",
    guidance: "لم يُرسَل الطلب، فلم يُقتطع شيء دون علمك. جرّب طلبًا أقصر.",
    tone: "blocked",
    icon: "stop",
  },
  PROVIDER_UNAVAILABLE: {
    label: "المزوّد غير متاح الآن",
    guidance: "لم يتم أي إجراء خارجي.",
    tone: "blocked",
    icon: "stop",
  },
  BLOCKED_BY_PROVIDER: {
    label: "المزوّد المطلوب غير متاح",
    guidance: "لم يتم أي إجراء خارجي. سيبقى الطلب كما هو حتى يتوفّر المزوّد.",
    tone: "blocked",
    icon: "stop",
  },
  BLOCKED_BY_RESOURCE: {
    label: "المورد المطلوب غير متاح",
    tone: "blocked",
    icon: "stop",
  },
  MISSING_GENERIC_CAPABILITY: {
    label: "لا تتوفّر لدى جاسم قدرة عامة تُنجز هذا بعد",
    guidance: "هذه حدود في قدرات جاسم الحالية، وليست خطأ في طلبك.",
    tone: "blocked",
    icon: "stop",
  },
  REQUIRES_APPROVAL: {
    label: "بانتظار موافقتك",
    guidance: "لن يُنفَّذ شيء قبل أن توافق.",
    tone: "warning",
    icon: "alert",
  },
  REQUIRES_OWNER_DECISION: {
    label: "بانتظار قرارك",
    tone: "warning",
    icon: "question",
  },
  REQUIRES_HUMAN: {
    label: "يحتاج تدخّلًا بشريًا",
    tone: "warning",
    icon: "alert",
  },
  INSUFFICIENT_INFORMATION: {
    label: "المعلومات المتاحة غير كافية",
    guidance: "أضف التفاصيل الناقصة ليكمل جاسم.",
    tone: "warning",
    icon: "question",
  },
  INSUFFICIENT_TRUST: {
    label: "مستوى الثقة غير كافٍ لهذا الإجراء",
    tone: "blocked",
    icon: "stop",
  },
  INCONCLUSIVE: {
    // The single most important entry here. "Inconclusive" means JASIM does not
    // know whether it worked — which is neither success nor failure, and must
    // never be rendered as either.
    label: "النتيجة غير مؤكّدة",
    guidance: "لا يمكن لجاسم تأكيد ما إذا كان الإجراء قد تمّ. لا تفترض النجاح.",
    tone: "warning",
    icon: "question",
  },
  STALE: {
    label: "هذه المعلومة ليست حديثة",
    guidance: "آخر مشاهدة مؤكّدة أقدم من أن تُعرض كحالة حالية.",
    tone: "stale",
    icon: "clock",
  },
  UNAVAILABLE: {
    label: "غير متاح",
    tone: "neutral",
    icon: "info",
  },
  EMPTY: {
    label: "لا توجد نتائج",
    guidance: "لا شيء مطابق حتى الآن — وهذه ليست مشكلة، بل نتيجة.",
    tone: "neutral",
    icon: "info",
  },
};

/**
 * Progress states, for Part 18.
 *
 * Each is a distinct sentence because "جارٍ التحميل…" for every wait teaches
 * people that the indicator means nothing. Knowing that JASIM is waiting on an
 * external provider rather than thinking is the difference between waiting
 * patiently and refreshing the page.
 *
 * None of them reports a completion ratio. Real measurable progress exists for
 * a durable Run with counted nodes and nowhere else; inventing a bar for the
 * rest would be a fabricated claim about how far along something is.
 */
export const RUNTIME_PROGRESS_COPY = {
  UNDERSTANDING: { label: "جاسم يفهم طلبك…", tone: "working", icon: "spinner" },
  SEARCHING: { label: "جاسم يبحث…", tone: "working", icon: "spinner" },
  WAITING_FOR_PROVIDER: {
    label: "بانتظار ردّ المزوّد…",
    tone: "working",
    icon: "clock",
  },
  AWAITING_APPROVAL: {
    label: "بانتظار موافقتك قبل المتابعة",
    tone: "warning",
    icon: "alert",
  },
  RUNNING: { label: "العملية قيد التنفيذ…", tone: "working", icon: "spinner" },
  BLOCKED: { label: "العملية متوقفة", tone: "blocked", icon: "stop" },
} as const satisfies Record<string, RuntimeStateCopy>;

export type RuntimeProgressKind = keyof typeof RUNTIME_PROGRESS_COPY;

/** CSS custom property per tone. Colour is the second signal, never the only one. */
export const TONE_TOKEN: Record<RuntimeStateTone, string> = {
  neutral: "var(--jasim-text-secondary)",
  info: "var(--jasim-info)",
  success: "var(--jasim-success)",
  warning: "var(--jasim-warning)",
  danger: "var(--jasim-danger)",
  blocked: "var(--jasim-blocked)",
  stale: "var(--jasim-stale)",
  working: "var(--jasim-accent)",
};

/** The textual glyph for each icon. Renders in any font, survives greyscale. */
export const ICON_GLYPH: Record<RuntimeStateCopy["icon"], string> = {
  info: "i",
  check: "✓",
  alert: "!",
  stop: "■",
  clock: "◷",
  spinner: "◌",
  question: "؟",
};

/**
 * Looks up copy for a runtime state.
 *
 * An unknown code returns `undefined` rather than a cheerful default, so the
 * caller has to decide what to show. A default would silently turn every new
 * runtime state into the same reassuring sentence — which is how a product ends
 * up telling people "حدث خطأ ما" about six genuinely different situations.
 */
export function runtimeStateCopy(code: unknown): RuntimeStateCopy | undefined {
  if (typeof code !== "string") return undefined;
  return RUNTIME_STATE_COPY[code.trim().toUpperCase()];
}
