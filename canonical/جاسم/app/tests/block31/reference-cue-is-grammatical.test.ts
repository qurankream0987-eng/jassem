/**
 * JASIM — THE REFERENCE CUE IS GRAMMAR, NOT A LIST OF THINGS.
 *
 * ─── THE DOMAIN THAT WAS LIVING IN THE CORE ─────────────────────────────────
 *
 * `referenceCuePattern` decided whether an utterance points at anything at
 * all, and it was ONE HAND-MAINTAINED LIST. Fifteen of its forty-nine
 * alternatives were domain nouns — «متجر», «الطلب», «الإعلان», «المنتج»,
 * «الخدمة», «السيارة», «الهاتف», `my store`, `product`, `car`, `phone`.
 *
 * So «اعرض لي السيارة» was a reference and «اعرض لي السائق» was NOTHING —
 * not «I could not resolve it», but «no reference was made». A domain nobody
 * had listed was invisible, in the file where that matters most.
 *
 *   NEW DOMAIN != NEW AGENT · DOMAIN_SPECIFIC_CORE = 0
 *
 * And no guard caught it: `frozen-corpus.test.ts` checks the BENCHMARK
 * machinery, and `unseen-ideas-holdout` checks a list of core files that never
 * included `jasim-runtime.ts`. This file is the guard that was missing.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The pattern's source, comments stripped: a rule may be NAMED in prose. */
function cueSource(): string {
  const file = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
  const start = file.indexOf("const STRUCTURAL_CUE_SOURCE");
  const end = file.indexOf("function referenceTokens");
  expect(start, "the cue sources must exist").toBeGreaterThan(-1);
  expect(end, "the cue block must end").toBeGreaterThan(start);
  return file
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

describe("what makes an utterance a reference is a property of language", () => {
  it("no domain noun decides whether somebody pointed at something", () => {
    const source = cueSource();
    const domains = [
      // The fifteen that were there.
      "متجر", "الطلب", "الإعلان", "المنتج", "الخدمة", "السيارة", "الهاتف", "الجهاز",
      "my store", "my platform", "product", "service", "car", "phone", "منص",
      // And a sample of ones nobody has listed, which must stay unlisted.
      "رافعة", "شاحنة", "سائق", "فندق", "وظيفة", "شقة", "مطعم",
      "crane", "truck", "driver", "hotel", "job", "flight", "invoice",
    ];
    for (const domain of domains) {
      expect(source, `the cue names «${domain}»`).not.toContain(domain);
    }
  });

  it("the runtime's OWN nouns are allowed, because they are not a domain", () => {
    // A conversation, a run, a task, a world: these are what JASIM is made of,
    // and a rule naming them names no business.
    const source = cueSource();
    for (const own of ["المحادثة", "الرسالة", "المهمة", "العملية", "العالم", "bubble", "run"]) {
      expect(source, own).toContain(own);
    }
  });

  it("grammar decides: a definite noun is a cue whatever the noun is", async () => {
    const runtime = await import("../../api/runtime/jasim-runtime");
    // Not exported, so this reads the behaviour through the only door there is:
    // the resolver's own status for an utterance with no world behind it.
    expect(typeof runtime.resolveRuntimeReferences).toBe("function");
    // The pattern itself, reconstructed from source, applied to words the
    // runtime has never seen.
    const source = cueSource();
    const definite = /const DEFINITE_CUE_SOURCE =\s*\n?\s*"([^"]+)"/.exec(source);
    expect(definite, "the definite cue must be declared as its own source").toBeTruthy();
    const pattern = new RegExp(definite![1]!.replace(/\\\\/g, "\\"), "iu");
    for (const unseen of ["السائق", "الرافعة", "المخطوطة", "الغواصة", "المسبار"]) {
      expect(pattern.test(`اعرض لي ${unseen}`), unseen).toBe(true);
    }
    // And English, the same way.
    expect(pattern.test("show me the manuscript")).toBe(true);
    // A bare «ال» on a two-letter word is not a noun worth pointing at.
    expect(pattern.test("الى هنا")).toBe(false);
  });

  it("a weak cue that matches nothing is not an unresolved reference", () => {
    //   A DEFINITE ARTICLE IS A WEAK CUE, NOT A CLAIM THAT SOMETHING WAS MEANT
    //
    // «ما الفرق بين الطاقة الشمسية وطاقة الرياح؟» carries a definite noun and
    // points at nothing. Answering it with «which one do you mean?» would be
    // the regression this rule exists to prevent.
    const file = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    const fn = file.slice(file.indexOf("export async function resolveRuntimeReferences"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain("weakCueOnly");
    // Both places that give up must respect it, not just the first.
    expect(body.split('weakCueOnly ? "not_requested" : "unresolved"').length - 1).toBe(2);
  });
});

describe("a word is uninformative because of the candidates, not itself", () => {
  /** The rule, read out of the runtime rather than restated here. */
  function runtimeSource(): string {
    return readFileSync("api/runtime/jasim-runtime.ts", "utf8");
  }

  it("the stopword list names no business", () => {
    const source = runtimeSource();
    const start = source.indexOf("const REFERENCE_STOPWORDS");
    const list = source.slice(start, source.indexOf("];", start));
    for (const domain of [
      // The six that were there.
      "متجر", "متجري", "منصة", "منصتي", "منتج", "خدمة",
      // And ones nobody listed, which must stay unlisted.
      "رافعة", "شاحنة", "سائق", "فندق", "شقة", "وظيفة",
      "store", "platform", "product", "service", "crane", "truck",
    ]) {
      expect(list, `the stopwords name «${domain}»`).not.toContain(domain);
    }
  });

  it("but grammar and the runtime's own nouns stay, because they are not a business", () => {
    const source = runtimeSource();
    const start = source.indexOf("const REFERENCE_STOPWORDS");
    const list = source.slice(start, source.indexOf("];", start));
    for (const kept of ["الذي", "هذه", "previous", "العملية", "فقاعة", "المحادثة"]) {
      expect(list, kept).toContain(kept);
    }
  });

  it("a word every candidate carries stops being evidence — whatever the word is", async () => {
    //
    // The proof that matters: not that the source says so, but that the
    // resolver BEHAVES so, on a noun that appears in no list anywhere.
    const { db } = await import("../../api/queries/connection");
    const { users, messages } = await import("@db/schema");
    const runtime = await import("../../api/runtime/jasim-runtime");
    const { eq } = await import("drizzle-orm");

    const [person] = await db
      .insert(users)
      .values({ unionId: `cue-${randomUUID()}`, name: "ش", preferences: {} } as never)
      .returning();
    const owner = String((person as { id: unknown }).id);

    /** Ask «اعرض لي الرافعة» against a world of `texts`. */
    async function ask(texts: readonly string[]) {
      const conversation = await runtime.createRuntimeConversation({ ownerId: owner, title: "ج" });
      await db.insert(messages).values(
        texts.map((content) => ({
          conversationId: Number(conversation.id),
          role: "assistant" as const,
          content,
          ownerId: owner,
        })) as never,
      );
      const resolution = await runtime.resolveRuntimeReferences({
        ownerId: owner,
        conversationId: conversation.id,
        content: "اعرض لي الرافعة",
      });
      await db.delete(messages).where(eq(messages.ownerId, owner));
      return resolution;
    }

    // ── ONE candidate carries the word: it is evidence, and it wins. ────────
    const distinguishing = await ask([
      "الرافعة الزرقاء جاهزة",
      "الشاحنة في الطريق",
      "الطلب مؤجل",
      "الموعد غدا",
    ]);
    expect(distinguishing.status, "one candidate carries it").toBe("resolved");

    // ── EVERY candidate carries it: it separates none of them. ──────────────
    //
    // Nothing anywhere lists «رافعة». The old list knew this property for six
    // business nouns and for no others; the rule knows it for all of them.
    const uninformative = await ask([
      "الرافعة الزرقاء جاهزة",
      "الرافعة الحمراء مشغولة",
      "الرافعة الصفراء في الصيانة",
      "الرافعة البيضاء محجوزة",
    ]);
    expect(uninformative.status, "every candidate carries it").not.toBe("resolved");
  });
});
