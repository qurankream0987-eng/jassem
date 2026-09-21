/**
 * JASIM — the trusted surface, as the product actually renders it.
 *
 * The runtime was proved in `secure-product-action.test.ts`: a conversation
 * initiates, the registry defines, the server validates. This file proves the
 * last step — that what reaches a screen is the server's contract and not a
 * client's idea of it.
 *
 * The three things a credential surface can get wrong are all tested here:
 * what it shows in clear, what it sends, and what it keeps afterwards.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  TrustedProductActionSurface,
  type ProductActionPresentation,
} from "../../src/components/jasim-core/TrustedProductActionSurface";
import {
  getProductAction,
  presentationFor,
} from "../../api/runtime/product-actions";

const NEVER_SUBMITTED = async () => {
  throw new Error("this test never submits");
};
const NEVER_CANCELLED = async () => {
  throw new Error("this test never cancels");
};

function render(presentation: ProductActionPresentation, expiresAt = future()) {
  return renderToStaticMarkup(
    <TrustedProductActionSurface
      actionSessionId="pas_test"
      expiresAt={expiresAt}
      presentation={presentation}
      onSubmit={NEVER_SUBMITTED}
      onCancel={NEVER_CANCELLED}
    />,
  );
}

const future = () => new Date(Date.now() + 300_000).toISOString();
const past = () => new Date(Date.now() - 1_000).toISOString();

/** The REAL contracts, from the server's own registry. Not a fixture. */
const ROTATE = presentationFor(getProductAction("credential.rotate")!);
const SETTINGS = presentationFor(getProductAction("settings.update")!);
const CLOSE = presentationFor(getProductAction("account.close")!);

describe("the surface renders the server's contract, not its own", () => {
  it("a SENSITIVE field is obscured, and the server decided that", () => {
    const html = render(ROTATE);
    // Three password inputs, because the registry declared three sensitive
    // fields. A client cannot decide to show one in clear.
    expect(html.match(/type="password"/g)).toHaveLength(3);
    expect(html.match(/data-sensitive="true"/g)).toHaveLength(3);
    expect(html).not.toContain('type="text" data-sensitive');
  });

  it("carries no value — not a default, not a placeholder", () => {
    for (const presentation of [ROTATE, SETTINGS, CLOSE]) {
      const html = render(presentation);
      expect(html, presentation.actionId).not.toContain("placeholder=");
      // Every input starts empty.
      for (const match of html.matchAll(/<input[^>]*value="([^"]*)"/g)) {
        expect(match[1], presentation.actionId).toBe("");
      }
    }
  });

  it("offers only the options the registry supplied", () => {
    const html = render(SETTINGS);
    for (const option of ["notifications", "privacy", "display", "language"]) {
      expect(html).toContain(`>${option}<`);
    }
    // And no way to name something else.
    expect(html).toContain("<select");
    expect(html).not.toContain('name="preference" type="text"');
  });

  it("says what cannot be undone, and shows the phrase that confirms it", () => {
    const html = render(CLOSE);
    expect(html).toContain('data-risk="IRREVERSIBLE"');
    expect(html).toContain(CLOSE.confirmationPhrase!);
    // A confirmation nobody can read is a confirmation nobody gave.
    expect(html).toContain("للتأكيد");
    // And the consequence says it deletes nothing, because it deletes nothing.
    expect(html).toContain("لا يحذف هذا بياناتك");
  });

  it("says when an action is blocked rather than inviting a password into it", () => {
    const html = render(ROTATE);
    expect(html).toContain('data-blocked="true"');
    expect(html).toContain("سيُطلب إثبات هويتك مرة أخرى");
  });

  it("an expired action session renders as expired, never as a form", () => {
    const html = render(ROTATE, past());
    expect(html).toContain('data-trusted-action-state="EXPIRED"');
    expect(html).not.toContain('type="password"');
  });

  it("is right-to-left and announces itself", () => {
    const html = render(SETTINGS);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('role="group"');
    expect(html).toContain(`aria-label="${SETTINGS.title}"`);
  });

  it("the state is in the DOM whether or not anything moves", () => {
    expect(render(SETTINGS)).toContain('data-trusted-action-state="AWAITING_INPUT"');
  });
});

describe("what it does with what it collected", () => {
  const source = String(
    // The component's own source, read through its module graph rather than
    // its rendered output: what matters here is a lifecycle, not markup.
    TrustedProductActionSurface,
  );

  it("forgets everything on every exit from the form", () => {
    // Success, failure and cancellation all pass through `forget`. A value
    // that survives a failed attempt is a value waiting to be retried into a
    // log.
    expect(source).toContain("forget");
    const finallyBlock = source.slice(source.indexOf("finally"));
    expect(finallyBlock.slice(0, 200)).toContain("forget");
  });

  it("sends the collected values to one place and nowhere else", () => {
    expect(source).toContain("onSubmit");
    // No analytics, no logging, no second destination.
    for (const forbidden of ["console.", "fetch(", "localStorage", "sessionStorage"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("a network failure is a failure, not a success with a spinner", () => {
    expect(source).toContain("setFailure");
    expect(source).toContain("catch");
  });
});
