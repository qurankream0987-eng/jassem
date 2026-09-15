import { z } from "zod";
import { createRouter, authedQuery, publicQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { widgets, widgetEvents } from "@db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

function generateEmbedToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "jasim_";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateEmbedCode(token: string, config: Record<string, unknown>): string {
  const host = (config.host as string) || "cdn.jasim.ai";
  return `<!-- JASIM Widget -->
<script>
  (function() {
    var s = document.createElement('script');
    s.src = 'https://${host}/widget.js?t=${token}';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  })();
</script>
<!-- End JASIM Widget -->`;
}

export const widgetRouter = createRouter({
  /** Create a new widget configuration (protected) */
  create: authedQuery
    .input(z.object({
      merchantId: z.number(),
      name: z.string().min(1).max(255),
      widgetType: z.enum([
        "chat", "booking", "product_carousel", "review",
        "payment_button", "lead_form", "availability", "custom",
      ]),
      config: z.record(z.unknown()),
      appearance: z.record(z.string()).optional(),
      allowedDomains: z.array(z.string()).optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const embedToken = generateEmbedToken();
      const [widget] = await db.insert(widgets).values({
        merchantId: input.merchantId,
        name: input.name,
        widgetType: input.widgetType,
        config: input.config,
        appearance: input.appearance,
        allowedDomains: input.allowedDomains,
        embedToken,
        isActive: true,
        impressionCount: 0,
        interactionCount: 0,
        conversionCount: 0,
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        widgetId: widget.id,
        embedToken,
      };
    }),

  /** Get widget configuration (public — for widget.js loader) */
  get: publicQuery
    .input(z.object({
      embedToken: z.string(),
    }))
    .query(async ({ input }) => {
      const [widget] = await db.select().from(widgets)
        .where(eq(widgets.embedToken, input.embedToken))
        .limit(1);

      if (!widget || !widget.isActive) {
        return null;
      }

      // Return safe public config (no internal fields)
      return {
        id: widget.id,
        name: widget.name,
        widgetType: widget.widgetType,
        config: widget.config,
        appearance: widget.appearance,
        allowedDomains: widget.allowedDomains,
      };
    }),

  /** Update a widget (protected) */
  update: authedQuery
    .input(z.object({
      widgetId: z.number(),
      merchantId: z.number(),
      name: z.string().min(1).max(255).optional(),
      config: z.record(z.unknown()).optional(),
      appearance: z.record(z.string()).optional(),
      allowedDomains: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { widgetId, merchantId, ...updates } = input;
      await db.update(widgets)
        .set(updates)
        .where(
          and(
            eq(widgets.id, widgetId),
            eq(widgets.merchantId, merchantId),
          ),
        );
      return { success: true };
    }),

  /** Delete a widget (protected) */
  delete: authedQuery
    .input(z.object({
      widgetId: z.number(),
      merchantId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.delete(widgets)
        .where(
          and(
            eq(widgets.id, input.widgetId),
            eq(widgets.merchantId, input.merchantId),
          ),
        );
      return { success: true };
    }),

  /** Get widget usage analytics (protected) */
  getAnalytics: authedQuery
    .input(z.object({
      widgetId: z.number(),
      merchantId: z.number(),
      days: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const [widget] = await db.select().from(widgets)
        .where(
          and(
            eq(widgets.id, input.widgetId),
            eq(widgets.merchantId, input.merchantId),
          ),
        )
        .limit(1);

      if (!widget) return null;

      // Get recent events
      const events = await db.select().from(widgetEvents)
        .where(eq(widgetEvents.widgetId, input.widgetId))
        .orderBy(desc(widgetEvents.createdAt))
        .limit(input.days * 10);

      // Aggregate by event type
      const byType = events.reduce((acc, e) => {
        acc[e.eventType] = (acc[e.eventType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        widgetId: widget.id,
        name: widget.name,
        widgetType: widget.widgetType,
        isActive: widget.isActive,
        totals: {
          impressions: widget.impressionCount,
          interactions: widget.interactionCount,
          conversions: widget.conversionCount,
        },
        byEventType: byType,
        recentEvents: events.slice(0, 50),
      };
    }),

  /** Generate embed code for a widget (protected) */
  generateCode: authedQuery
    .input(z.object({
      widgetId: z.number(),
      merchantId: z.number(),
      host: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const [widget] = await db.select().from(widgets)
        .where(
          and(
            eq(widgets.id, input.widgetId),
            eq(widgets.merchantId, input.merchantId),
          ),
        )
        .limit(1);

      if (!widget) return null;

      const embedCode = generateEmbedCode(widget.embedToken, {
        host: input.host,
        ...widget.config,
      });

      return {
        widgetId: widget.id,
        name: widget.name,
        embedToken: widget.embedToken,
        embedCode,
        allowedDomains: widget.allowedDomains,
      };
    }),

  /** Track a widget event (public — called from embedded widgets) */
  trackEvent: publicQuery
    .input(z.object({
      embedToken: z.string(),
      eventType: z.enum(["impression", "interaction", "click", "conversion", "error", "custom"]),
      sessionId: z.string().optional(),
      url: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const [widget] = await db.select().from(widgets)
        .where(eq(widgets.embedToken, input.embedToken))
        .limit(1);

      if (!widget || !widget.isActive) {
        return { success: false, message: "Widget not found or inactive" };
      }

      // Log the event
      await db.insert(widgetEvents).values({
        widgetId: widget.id,
        eventType: input.eventType,
        sessionId: input.sessionId,
        url: input.url,
        metadata: input.metadata,
      });

      // Update counters
      const counterUpdates: Record<string, number> = {};
      if (input.eventType === "impression") {
        counterUpdates.impressionCount = (widget.impressionCount || 0) + 1;
      } else if (input.eventType === "interaction") {
        counterUpdates.interactionCount = (widget.interactionCount || 0) + 1;
      } else if (input.eventType === "conversion") {
        counterUpdates.conversionCount = (widget.conversionCount || 0) + 1;
      }

      if (Object.keys(counterUpdates).length > 0) {
        await db.update(widgets)
          .set(counterUpdates)
          .where(eq(widgets.id, widget.id));
      }

      return { success: true, widgetId: widget.id };
    }),
});
