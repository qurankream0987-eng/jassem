/**
 * JASIM — a pasted credential does not become a conversation title.
 *
 * Wave 1 made titles derive from the first user message, which created a
 * SECOND place a credential lands. These tests pin that second place shut.
 *
 * They do NOT claim the message itself is protected. It is still stored and
 * still reaches the model; that rule belongs to the Conversation-First
 * secure-auth phase.
 */

import { describe, expect, it } from "vitest";
import {
  containsCredentialShape,
  credentialShapeIn,
} from "../../api/runtime/credential-shapes";
import {
  PRIVATE_TITLE_FALLBACK,
  deriveConversationTitle,
} from "../../api/runtime/conversation-title";

describe("shapes that are recognised", () => {
  it.each([
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA", "PRIVATE_KEY_BLOCK"],
    ["-----BEGIN PRIVATE KEY-----", "PRIVATE_KEY_BLOCK"],
    [
      "eyJhbGciOiJIUzI1NiJ9.eyJ1bmlvbklkIjoiZGV2OmxvY2FsIn0.zFtufxqNQ5a0F_Tk058N00B",
      "JWT",
    ],
    ["Authorization: Bearer abcdefghijklmnop", "AUTHORIZATION_HEADER"],
    ["bearer abcdefghijklmnopqrstuvwx", "AUTHORIZATION_HEADER"],
  ])("«%s» is %s", (text, expected) => {
    expect(credentialShapeIn(text)).toBe(expected);
  });

  it.each([
    "sk-abcdefghijklmnopqrstuvwxyz12",
    "sk_live_abcdefghijkl1234",
    "ghp_abcdefghijklmnopqrstuvwxyz12",
    "github_pat_11ABCDEFG0abcdefghij",
    "glpat-abcdefghijklmnop",
    "xoxb-1234567890-abcdefghij",
    "AKIAIOSFODNN7EXAMPLE",
    "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "npm_abcdefghijklmnopqrstuvwxyz",
    "hf_abcdefghijklmnopqrstuvwx",
  ])("the provider prefix in «%s» is recognised on shape alone", (text) => {
    expect(credentialShapeIn(`هذا هو ${text} تفضل`)).toBe("KNOWN_KEY_PREFIX");
  });

  it.each([
    "password: hunter2xyz",
    "Password = correcthorse",
    "api key: abc123def456",
    "API_KEY=abcd1234efgh",
    "client secret: s3cr3tvalue",
    "access token: abcd1234efgh5678",
    "كلمة المرور: hunter2xyz",
    "كلمة السر = abc12345",
    "الرقم السري: 483920",
    "رمز التحقق: 483920",
    "كود التحقق = 928471",
    "otp: 483920",
    "pin: 4829",
    "cvv: 4829",
    "seed phrase: abandon ability able about",
  ])("«%s» is a labelled secret", (text) => {
    expect(credentialShapeIn(text)).toBe("LABELLED_SECRET");
  });

  it.each(["otp 483920", "رمز التحقق 483920", "pin 92841"])(
    "«%s» is recognised without a colon, because the value looks like one",
    (text) => {
      expect(credentialShapeIn(text)).toBe("LABELLED_SECRET");
    },
  );

  it("a long generated run is recognised on entropy alone", () => {
    expect(credentialShapeIn("خذ هذا aZ3kQ9mP2xR7tW1yB5nC8vF4jH6dL0sG")).toBe(
      "OPAQUE_HIGH_ENTROPY",
    );
  });
});

describe("the word is not the secret", () => {
  // A blanket block on the word "password" would hide ordinary conversations
  // behind a privacy label and teach people the feature is broken.
  it.each([
    "كيف أغير كلمة المرور؟",
    "نسيت كلمة السر، ساعدني",
    "أريد تفعيل المصادقة الثنائية",
    "how do I reset my password?",
    "explain what an api key is",
    "ما هو رمز التحقق ولماذا نحتاجه؟",
    "اشرح لي كيف يعمل الـ OTP",
  ])("«%s» contains no credential", (text) => {
    expect(credentialShapeIn(text)).toBeNull();
  });

  it("an empty value does not count", () => {
    expect(credentialShapeIn("password:")).toBeNull();
    expect(credentialShapeIn("كلمة المرور: ؟")).toBeNull();
  });
});

describe("ordinary messages are left alone", () => {
  it.each([
    "أنشئ منصة لبيع الأثاث المستعمل",
    "قارن المصدر الثاني والرابع",
    "اعرض لي السائق",
    "رتب لي موعداً غداً الساعة العاشرة صباحاً",
    "Compare three pricing plans with features and ratings",
    "ابحث عن لابتوبات بأقل من 3000 ريال",
  ])("«%s» is not credential-shaped", (text) => {
    expect(containsCredentialShape(text)).toBe(false);
  });

  it("a long URL is not a secret", () => {
    // Renaming somebody's conversation «محادثة خاصة» because they shared a
    // link would be a false positive people actually hit.
    expect(
      containsCredentialShape(
        "شوف هذا https://example.com/articles/2026/09/a-very-long-path-Ab3Cd4Ef5Gh6Ij7Kl8Mn9",
      ),
    ).toBe(false);
  });

  it("a long Arabic sentence is not high entropy", () => {
    expect(
      containsCredentialShape(
        "أريد منك أن تساعدني في تنظيم عملية التوظيف لفريق تقني جديد خلال الشهر القادم",
      ),
    ).toBe(false);
  });

  it("a hex digest alone is not treated as a credential", () => {
    // No mixed case. Hashes, commit ids and checksums are shared constantly.
    expect(containsCredentialShape("d41d8cd98f00b204e9800998ecf8427ed41d8cd9")).toBe(false);
  });

  it("a repeated run is not high entropy", () => {
    expect(containsCredentialShape("Aaaaaaaa1111111111Aaaaaaaa1111111111")).toBe(false);
  });

  it("survives a non-string and an empty string", () => {
    expect(credentialShapeIn(undefined as unknown as string)).toBeNull();
    expect(credentialShapeIn("")).toBeNull();
  });
});

describe("the title itself", () => {
  it.each([
    "password: hunter2xyz",
    "كلمة المرور هي: mySecret123",
    "sk-abcdefghijklmnopqrstuvwxyz12",
    "Authorization: Bearer abcdefghijklmnop",
    "eyJhbGciOiJIUzI1NiJ9.eyJhIjoiYiJ9.c3VwZXJzZWNyZXQ",
  ])("«%s» becomes the fixed private title", (text) => {
    expect(deriveConversationTitle(text)).toBe(PRIVATE_TITLE_FALLBACK);
  });

  it("the fallback carries no fragment of the message", () => {
    // Not a redaction. A redaction leaks length, prefix and provider.
    const title = deriveConversationTitle("my api key is sk-abcdefghijklmnopqrstuvwxyz12")!;
    expect(title).toBe(PRIVATE_TITLE_FALLBACK);
    expect(title).not.toMatch(/sk-/);
    expect(title).not.toMatch(/abcdefghij/);
    expect(title).not.toMatch(/api/i);
    expect(title).not.toMatch(/\*|…|x{3}/);
  });

  it("a secret later in the message still triggers the fallback", () => {
    // Otherwise the check would depend on where a full stop happened to fall.
    expect(deriveConversationTitle("مرحبا. كلمة المرور: hunter2xyz")).toBe(
      PRIVATE_TITLE_FALLBACK,
    );
  });

  it("a secret split across lines still triggers the fallback", () => {
    expect(deriveConversationTitle("سجلني دخول\nكلمة المرور: hunter2xyz")).toBe(
      PRIVATE_TITLE_FALLBACK,
    );
  });

  it("ordinary titles are untouched by this change", () => {
    expect(deriveConversationTitle("أنشئ منصة لبيع الأثاث المستعمل")).toBe(
      "أنشئ منصة لبيع الأثاث المستعمل",
    );
    // The «؟» is dropped by the pre-existing clause break, not by this change.
    expect(deriveConversationTitle("كيف أغير كلمة المرور؟")).toBe("كيف أغير كلمة المرور");
  });

  it("an empty message still has no title, rather than a private one", () => {
    // `undefined` and the fallback mean different things. Nothing was written,
    // so nothing is hidden.
    expect(deriveConversationTitle("   ")).toBeUndefined();
    expect(deriveConversationTitle("!!!")).toBeUndefined();
  });
});
