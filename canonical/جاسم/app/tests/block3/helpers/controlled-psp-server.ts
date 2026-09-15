/**
 * Block 3 §30–§31 — the CONTROLLED_TEST_PROVIDER: a minimal PSP over a REAL
 * HTTP boundary (never an in-process mock). It speaks the generic payment
 * contract (authorize/capture/refund/readback) with exact minor-unit money,
 * signs callbacks with HMAC-SHA256, and supports scripted failure modes for
 * crash-recovery and adversarial truth tests.
 *
 * Test-only: this server exists to prove the payment truth engine against a
 * real network hop. Production PSP integration stays BLOCKED_BY_PROVIDER.
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type PspPayment = {
  id: string;
  status: "AUTHORIZED" | "CAPTURED" | "REFUNDED" | "FAILED";
  amountMinor: string;
  currency: string;
  reference: string;
};
export type PspPayout = {
  id: string;
  status: "EXECUTED";
  amountMinor: string;
  currency: string;
  destinationRef: string;
};

export type PspFailureMode =
  | "none"
  /** Capture succeeds provider-side but the HTTP response never arrives. */
  | "crash_after_capture"
  /** Readback always claims NOT_CAPTURED regardless of actual state. */
  | "readback_lies_uncaptured"
  /** Capture reports a different amount than authorized. */
  | "amount_mismatch";

export type ControlledPsp = {
  url: string;
  webhookSecret: string;
  payments: Map<string, PspPayment>;
  payouts: Map<string, PspPayout>;
  setFailureMode(mode: PspFailureMode): void;
  /** Webhooks the PSP sent (tests deliver them through the auth boundary). */
  sentCallbacks: Array<{ rawBody: string; signature: string }>;
  close(): Promise<void>;
};

export async function startControlledPsp(): Promise<ControlledPsp> {
  const payments = new Map<string, PspPayment>();
  const payouts = new Map<string, PspPayout>();
  const refundKeys = new Map<string, PspPayment>();
  const sentCallbacks: Array<{ rawBody: string; signature: string }> = [];
  const webhookSecret = "whsec_controlled_psp";
  let failureMode: PspFailureMode = "none";
  let seq = 0;

  function readBody(req: import("node:http").IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function callbackFor(payment: PspPayment, eventType: string): void {
    const rawBody = JSON.stringify({
      eventType,
      reference: payment.reference,
      paymentId: payment.id,
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      timestamp: Date.now(),
    });
    const signature = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");
    sentCallbacks.push({ rawBody, signature });
  }

  const server: Server = createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      const text = JSON.stringify(body);
      res.writeHead(code, { "content-type": "application/json" });
      res.end(text);
    };
    try {
      const url = new URL(req.url ?? "/", "http://psp");
      const bodyText = await readBody(req);
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

      if (req.method === "POST" && url.pathname === "/payments") {
        // authorize
        const payment: PspPayment = {
          id: `psp_${++seq}`,
          status: "AUTHORIZED",
          amountMinor: String(body.amountMinor),
          currency: String(body.currency),
          reference: String(body.reference),
        };
        payments.set(payment.id, payment);
        callbackFor(payment, "payment.authorized");
        return send(200, payment);
      }

      if (req.method === "POST" && url.pathname === "/payouts") {
        const payout: PspPayout = {
          id: body.payoutId ? `payout_${String(body.payoutId)}` : `payout_${++seq}`, status: "EXECUTED",
          amountMinor: String(body.amountMinor), currency: String(body.currency),
          destinationRef: String(body.destinationRef),
        };
        payouts.set(payout.id, payout);
        if (failureMode === "crash_after_capture") {
          req.socket.destroy();
          return;
        }
        return send(200, payout);
      }

      const captureMatch = /^\/payments\/([^/]+)\/capture$/.exec(url.pathname);
      if (req.method === "POST" && captureMatch) {
        const payment = payments.get(captureMatch[1]);
        if (!payment) return send(404, { error: "not_found" });
        if (payment.status !== "AUTHORIZED") return send(409, { error: "invalid_state", status: payment.status });
        payment.status = "CAPTURED";
        callbackFor(payment, "payment.captured");
        if (failureMode === "crash_after_capture") {
          // The effect HAPPENED; the response is lost. Executor must become INCONCLUSIVE.
          req.socket.destroy();
          return;
        }
        if (failureMode === "amount_mismatch") {
          return send(200, { ...payment, amountMinor: String(BigInt(payment.amountMinor) + 1n) });
        }
        return send(200, payment);
      }

      const refundMatch = /^\/payments\/([^/]+)\/refund$/.exec(url.pathname);
      if (req.method === "POST" && refundMatch) {
        const payment = payments.get(refundMatch[1]);
        if (!payment) return send(404, { error: "not_found" });
        // Provider-side refund idempotency: the same idempotency key replays
        // the original outcome instead of double-refunding.
        const idemKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;
        if (idemKey) {
          const prior = refundKeys.get(idemKey);
          if (prior) return send(200, prior);
        }
        if (payment.status !== "CAPTURED") return send(409, { error: "invalid_state", status: payment.status });
        payment.status = "REFUNDED";
        callbackFor(payment, "payment.refunded");
        if (idemKey) refundKeys.set(idemKey, payment);
        return send(200, payment);
      }

      const readbackMatch = /^\/payments\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && readbackMatch) {
        const payment = payments.get(readbackMatch[1]);
        if (!payment) return send(404, { error: "not_found" });
        if (failureMode === "readback_lies_uncaptured") {
          return send(200, { ...payment, status: "NOT_CAPTURED" });
        }
        return send(200, payment);
      }

      const payoutReadbackMatch = /^\/payouts\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && payoutReadbackMatch) {
        const payout = payouts.get(payoutReadbackMatch[1]);
        if (!payout) return send(404, { error: "not_found" });
        return send(200, payout);
      }

      return send(404, { error: "unknown_route" });
    } catch (error) {
      return send(500, { error: error instanceof Error ? error.message : "psp_error" });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    webhookSecret,
    payments,
    payouts,
    setFailureMode: (mode) => {
      failureMode = mode;
    },
    sentCallbacks,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
