/**
 * JASIM — the mobile runtime address, dev and production.
 *
 * ─── WHAT WENT WRONG ────────────────────────────────────────────────────────
 *
 * Four call sites in the mobile app each built `https://${EXPO_PUBLIC_DOMAIN}`
 * with the scheme written into the string. That is right for production and it
 * made local development impossible: a dev runtime speaks HTTP on a loopback
 * port, so the mobile product could not be run against a live runtime at all
 * without deploying first.
 *
 * The obvious repair — "let a dev build use http" — is the dangerous one. A
 * debug build talking plaintext to a *real host over a real network* is a
 * worse outcome than the bug it fixes, and a bearer token travels on the very
 * first request. So the rule has two halves, and this file pins both:
 *
 *   • Production is HTTPS. Always. No flag, no env var, no override.
 *   • Development may use HTTP, and ONLY to a local address.
 *
 * ─── AND ONE PLACE TO SAY IT ────────────────────────────────────────────────
 *
 * A rule enforced in three of four modules is not enforced. The last group of
 * tests reads the mobile sources directly and fails if any of them starts
 * building a URL of its own again.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RuntimeConfigError,
  hasRuntimeEndpoint,
  runtimeBaseUrl,
  runtimeEndpoint,
  runtimeScheme,
  runtimeUrl,
} from "../../../../../artifacts/jasim-mobile/lib/runtime-endpoint";

const MOBILE_ROOT = join(__dirname, "../../../../../artifacts/jasim-mobile");

/**
 * `__DEV__` is injected by the React Native bundler, not by Node. The module
 * reads it through `typeof`, so a test declares the build kind by defining or
 * deleting the global — the same signal a real build gives it.
 */
function asBuild(kind: "development" | "production", run: () => void): void {
  const globals = globalThis as Record<string, unknown>;
  if (kind === "development") globals.__DEV__ = true;
  else delete globals.__DEV__;
  try {
    run();
  } finally {
    delete globals.__DEV__;
  }
}

function withDomain(value: string | undefined, run: () => void): void {
  const previous = process.env.EXPO_PUBLIC_DOMAIN;
  if (value === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
  else process.env.EXPO_PUBLIC_DOMAIN = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
    else process.env.EXPO_PUBLIC_DOMAIN = previous;
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__DEV__;
});

describe("production never downgrades to HTTP", () => {
  it("assumes HTTPS when the domain carries no scheme", () => {
    asBuild("production", () =>
      withDomain("jasim.example.com", () => {
        expect(runtimeBaseUrl()).toBe("https://jasim.example.com");
      }),
    );
  });

  it("refuses an explicit http:// endpoint outright", () => {
    asBuild("production", () =>
      withDomain("http://jasim.example.com", () => {
        expect(() => runtimeBaseUrl()).toThrow(RuntimeConfigError);
      }),
    );
  });

  it("refuses http even to a local address", () => {
    // A production build has no business talking to loopback, so the dev
    // exception is not merely unnecessary here — granting it would be a way
    // to reach the plaintext path from a shipped binary.
    asBuild("production", () =>
      withDomain("http://127.0.0.1:5731", () => {
        expect(() => runtimeBaseUrl()).toThrow(RuntimeConfigError);
      }),
    );
  });

  it("keeps an explicit https:// endpoint", () => {
    asBuild("production", () =>
      withDomain("https://jasim.example.com/", () => {
        expect(runtimeBaseUrl()).toBe("https://jasim.example.com");
      }),
    );
  });
});

describe("development may use HTTP, and only locally", () => {
  it.each([
    "http://localhost:5731",
    "http://127.0.0.1:5731",
    "http://192.168.1.14:5731",
    "http://10.0.2.2:5731",
    "http://172.16.0.9:5731",
    "http://macbook.local:5731",
  ])("accepts %s", (domain) => {
    asBuild("development", () =>
      withDomain(domain, () => {
        expect(runtimeBaseUrl()).toBe(domain);
      }),
    );
  });

  it.each([
    "http://jasim.example.com",
    "http://172.32.0.1:5731",
    "http://203.0.113.10",
  ])("refuses %s — plaintext over a real network is the actual risk", (domain) => {
    asBuild("development", () =>
      withDomain(domain, () => {
        expect(() => runtimeBaseUrl()).toThrow(RuntimeConfigError);
      }),
    );
  });

  it("still defaults to HTTPS when no scheme is given", () => {
    // Being a dev build is permission to use http when asked, not a reason to
    // choose it. An ambiguous configuration resolves to the safe side in both
    // build kinds.
    asBuild("development", () =>
      withDomain("jasim.example.com", () => {
        expect(runtimeBaseUrl()).toBe("https://jasim.example.com");
      }),
    );
  });

  it("accepts an https local address too", () => {
    asBuild("development", () =>
      withDomain("https://127.0.0.1:5731", () => {
        expect(runtimeBaseUrl()).toBe("https://127.0.0.1:5731");
      }),
    );
  });
});

describe("an unconfigured build says so, without leaking internals", () => {
  it("throws a RuntimeConfigError when the domain is missing", () => {
    asBuild("production", () =>
      withDomain(undefined, () => {
        expect(() => runtimeBaseUrl()).toThrow(RuntimeConfigError);
      }),
    );
  });

  it.each(["", "   ", "https://"])("throws for %o", (domain) => {
    asBuild("production", () =>
      withDomain(domain, () => {
        expect(() => runtimeBaseUrl()).toThrow(RuntimeConfigError);
      }),
    );
  });

  it("carries a user-safe Arabic message that names no internals", () => {
    asBuild("production", () =>
      withDomain(undefined, () => {
        let caught: unknown;
        try {
          runtimeBaseUrl();
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(RuntimeConfigError);
        const message = (caught as RuntimeConfigError).userMessage;
        expect(message.length).toBeGreaterThan(0);
        // The technical cause stays on `.message` for a developer; the text a
        // person reads names no environment variable, host or scheme.
        expect(message).not.toMatch(/EXPO_PUBLIC_DOMAIN|https?|localhost/i);
        expect((caught as RuntimeConfigError).message).toMatch(/EXPO_PUBLIC_DOMAIN|plaintext|local/i);
      }),
    );
  });

  it("hasRuntimeEndpoint answers false instead of throwing", () => {
    asBuild("production", () =>
      withDomain(undefined, () => {
        expect(hasRuntimeEndpoint()).toBe(false);
      }),
    );
    asBuild("production", () =>
      withDomain("http://jasim.example.com", () => {
        expect(hasRuntimeEndpoint()).toBe(false);
      }),
    );
    asBuild("production", () =>
      withDomain("jasim.example.com", () => {
        expect(hasRuntimeEndpoint()).toBe(true);
      }),
    );
  });
});

describe("everything built on the base inherits the rule", () => {
  it("runtimeEndpoint appends the tRPC path to the resolved base", () => {
    asBuild("production", () =>
      withDomain("jasim.example.com", () => {
        expect(runtimeEndpoint("runtime.conversationsList")).toBe(
          "https://jasim.example.com/api/trpc/runtime.conversationsList",
        );
      }),
    );
  });

  it("runtimeEndpoint refuses rather than falling back to a guess", () => {
    asBuild("production", () =>
      withDomain("http://jasim.example.com", () => {
        expect(() => runtimeEndpoint("runtime.conversationsList")).toThrow(RuntimeConfigError);
      }),
    );
  });

  it("runtimeScheme reports what was actually resolved", () => {
    asBuild("development", () =>
      withDomain("http://127.0.0.1:5731", () => {
        expect(runtimeScheme()).toBe("http:");
      }),
    );
    asBuild("production", () =>
      withDomain("jasim.example.com", () => {
        expect(runtimeScheme()).toBe("https:");
      }),
    );
  });

  it("runtimeUrl joins an absolute path onto the resolved base", () => {
    asBuild("production", () =>
      withDomain("jasim.example.com", () => {
        expect(runtimeUrl("/api/runtime/generated-image/abc")).toBe(
          "https://jasim.example.com/api/runtime/generated-image/abc",
        );
      }),
    );
  });
});

describe("one config system, not two", () => {
  const SOURCES = [
    "lib/session.tsx",
    "lib/runtime-trpc.ts",
    "app/index.tsx",
  ] as const;

  it.each(SOURCES)("%s builds no runtime URL of its own", (relative) => {
    const source = readFileSync(join(MOBILE_ROOT, relative), "utf8");
    // Comments explain the rule and would otherwise match it, so they go
    // first — the assertion is about code, not about prose.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/EXPO_PUBLIC_DOMAIN/);
    expect(code).not.toMatch(/['"`]https?:\/\//);
  });

  it("the resolver is the only module that reads the domain variable", () => {
    const resolver = readFileSync(join(MOBILE_ROOT, "lib/runtime-endpoint.ts"), "utf8");
    expect(resolver).toMatch(/EXPO_PUBLIC_DOMAIN/);
  });
});
