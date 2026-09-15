import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { SafeMarkdownPreview } from "../../src/components/chat/SafeMarkdownPreview";
import {
  safeMediaUrl,
  safeThemeColor,
} from "../../src/components/jasim-core/SchemaRenderer";
import {
  safePresentationExternalUrl,
  safePresentationPath,
} from "@workspace/jasim-runtime-contract";

describe("Smart UI Task 9A security boundary", () => {
  it("renders hostile Markdown as text and only creates safe external links", () => {
    const markup = renderToStaticMarkup(
      <SafeMarkdownPreview
        text={'<img src=x onerror="alert(1)"> [run](javascript:alert(1)) [safe](https://example.com)'}
      />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).not.toMatch(/<[^>]+onerror=/);
    expect(markup).not.toContain('href="javascript:');
    expect(markup).toContain("run");
    expect(markup).toContain('href="https://example.com/"');
  });

  it("rejects executable URL schemes consistently for Web and Mobile", () => {
    expect(safePresentationExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safePresentationExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safePresentationExternalUrl("http://example.com")).toBeNull();
    expect(safePresentationExternalUrl("https://example.com")).toBe("https://example.com/");
    expect(safePresentationExternalUrl("http://example.com", ["http:", "https:"])).toBe(
      "http://example.com/",
    );
  });

  it("allows only bounded internal generated-artifact paths", () => {
    const prefix = "/api/runtime/generated-image/";
    expect(safePresentationPath(`${prefix}artifact.png`, prefix)).toBe(`${prefix}artifact.png`);
    expect(safePresentationPath("//attacker.example/image.png", prefix)).toBeNull();
    expect(safePresentationPath("/api/runtime/object-storage/secret", prefix)).toBeNull();
    expect(safePresentationPath(`${prefix}bad\u0000path`, prefix)).toBeNull();
  });

  it("fails closed for unsafe media and generated CSS colors", () => {
    expect(safeMediaUrl("javascript:alert(1)")).toBeNull();
    expect(safeMediaUrl("data:text/html,<svg onload=alert(1)>")).toBeNull();
    expect(safeMediaUrl("//attacker.example/image.png")).toBeNull();
    expect(safeMediaUrl("/api/runtime/generated-image/artifact.png")).toBe(
      "/api/runtime/generated-image/artifact.png",
    );
    expect(safeThemeColor("url(javascript:alert(1))", "#0f172a")).toBe("#0f172a");
    expect(safeThemeColor("#14b8a6", "#0f172a")).toBe("#14b8a6");
  });
});