import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedQuery, router } from "../trpc";
import { getExternalActionLedger, getExternalActionReconciler } from "../core/runtime";
import { ExternalActionStatusSchema, type ExternalActionRecord } from "@contracts/external-action";

function present(record: ExternalActionRecord) {
  return {
    id: record.id,
    taskId: String(record.taskId),
    stepId: record.stepId,
    connectorId: record.connectorId,
    capabilityId: record.capabilityId,
    effect: record.effect,
    status: record.status,
    providerReference: record.providerReference,
    attempts: record.attempts,
    errorCode: record.errorCode,
    nextReconcileAt: record.nextReconcileAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function reviewBubble(records: ExternalActionRecord[]) {
  return {
    id: `external_review_${Date.now()}`,
    type: "list" as const,
    title: "مراجعة العمليات الخارجية",
    subtitle: "هذه الحالات تُراجع بالاستعلام من المزود؛ لن يعيد جاسم تنفيذ الدفع أو الطلب.",
    layout: { width: "full" as const, rtl: true },
    data: { items: records.map(present), empty: records.length === 0 },
    actions: records.filter((record) => ["uncertain", "manual_review"].includes(record.status)).map((record) => ({
      id: `reconcile_${record.id}`,
      label: "تحقق من المزود",
      type: "submit" as const,
      payload: { actionId: record.id, operation: "reconcile_only" },
    })),
    trust: { level: "system" as const, verified: true, badges: ["idempotent", "read-only-reconciliation"] },
    version: "1.0.0",
    metadata: { generated: true, purpose: "external_action_review" },
  };
}

export const externalActionsRouter = router({
  list: authedQuery
    .input(z.object({
      statuses: z.array(ExternalActionStatusSchema).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const records = await getExternalActionLedger().listForUser(Number(ctx.user!.id), input?.limit ?? 50);
      const statuses = input?.statuses;
      const filtered = statuses?.length ? records.filter((record) => statuses.includes(record.status)) : records;
      return { actions: filtered.map(present), bubble: reviewBubble(filtered) };
    }),

  reconcile: authedQuery
    .input(z.object({ actionId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const action = await getExternalActionReconciler().reconcileById(input.actionId, Number(ctx.user!.id));
        return { action: present(action), bubble: reviewBubble([action]) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Reconciliation failed";
        throw new TRPCError({
          code: /not found/i.test(message) ? "NOT_FOUND" : "CONFLICT",
          message,
        });
      }
    }),
});
