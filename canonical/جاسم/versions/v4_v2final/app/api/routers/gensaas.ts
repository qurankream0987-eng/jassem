import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { saasTemplates, saasInstances, saasWorkflows, saasRoles, analytics } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

export const genSaasRouter = createRouter({
  /** List available SaaS templates */
  listTemplates: authedQuery
    .input(z.object({
      category: z.string().optional(),
      marketCode: z.string().optional(),
      activeOnly: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.activeOnly !== false) {
        conditions.push(eq(saasTemplates.isActive, true));
      }
      if (input?.category) {
        conditions.push(eq(saasTemplates.category, input.category));
      }
      if (input?.marketCode) {
        conditions.push(eq(saasTemplates.marketCode, input.marketCode));
      }

      const templates = conditions.length > 0
        ? await db.select().from(saasTemplates)
            .where(and(...conditions))
            .orderBy(desc(saasTemplates.createdAt))
            .limit(100)
        : await db.select().from(saasTemplates)
            .orderBy(desc(saasTemplates.createdAt))
            .limit(100);

      return templates;
    }),

  /** Get a specific template's details */
  getTemplate: authedQuery
    .input(z.object({
      slug: z.string(),
    }))
    .query(async ({ input }) => {
      const [template] = await db.select().from(saasTemplates)
        .where(eq(saasTemplates.slug, input.slug))
        .limit(1);
      return template || null;
    }),

  /** Deploy a SaaS instance from a template */
  deploy: authedQuery
    .input(z.object({
      templateId: z.number(),
      merchantId: z.number(),
      name: z.string().min(1).max(255),
      subdomain: z.string().regex(/^[a-z0-9-]+$/).optional(),
      customDomain: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const [template] = await db.select().from(saasTemplates)
        .where(eq(saasTemplates.id, input.templateId))
        .limit(1);

      if (!template) {
        throw new Error("Template not found");
      }

      const [instance] = await db.insert(saasInstances).values({
        templateId: input.templateId,
        merchantId: input.merchantId,
        name: input.name,
        subdomain: input.subdomain || `app-${Date.now()}`,
        customDomain: input.customDomain,
        status: "active",
        config: input.config || template.defaultConfig,
        analyticsData: { visitors: 0, orders: 0, revenue: 0 },
        deployedAt: new Date(),
        lastDeployedAt: new Date(),
        marketCode: input.marketCode,
      }).$returningId();

      // Create default roles for the instance
      const defaultRoles = [
        { name: "Admin", permissions: ["*"], isDefault: true },
        { name: "Manager", permissions: ["read", "write", "manage_orders"], isDefault: false },
        { name: "Viewer", permissions: ["read"], isDefault: false },
      ];

      for (const role of defaultRoles) {
        await db.insert(saasRoles).values({
          instanceId: instance.id,
          name: role.name,
          permissions: role.permissions,
          description: `${role.name} role`,
          isDefault: role.isDefault,
        });
      }

      return {
        success: true,
        instanceId: instance.id,
        subdomain: input.subdomain,
        status: "active",
      };
    }),

  /** Get a deployed instance */
  getInstance: authedQuery
    .input(z.object({
      instanceId: z.number(),
      merchantId: z.number(),
    }))
    .query(async ({ input }) => {
      const [instance] = await db.select().from(saasInstances)
        .where(
          and(
            eq(saasInstances.id, input.instanceId),
            eq(saasInstances.merchantId, input.merchantId),
          ),
        )
        .limit(1);

      if (!instance) return null;

      // Fetch associated workflows
      const workflows = await db.select().from(saasWorkflows)
        .where(eq(saasWorkflows.instanceId, input.instanceId));

      // Fetch roles
      const roles = await db.select().from(saasRoles)
        .where(eq(saasRoles.instanceId, input.instanceId));

      return { ...instance, workflows, roles };
    }),

  /** Update a workflow for an instance */
  updateWorkflow: authedQuery
    .input(z.object({
      instanceId: z.number(),
      workflowId: z.number().optional(),
      name: z.string().min(1).max(255),
      trigger: z.string().min(1).max(100),
      actions: z.array(z.record(z.unknown())),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      if (input.workflowId) {
        await db.update(saasWorkflows)
          .set({
            name: input.name,
            trigger: input.trigger,
            actions: input.actions,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(saasWorkflows.id, input.workflowId),
              eq(saasWorkflows.instanceId, input.instanceId),
            ),
          );
        return { success: true, workflowId: input.workflowId };
      }

      const [workflow] = await db.insert(saasWorkflows).values({
        instanceId: input.instanceId,
        name: input.name,
        trigger: input.trigger,
        actions: input.actions,
        isActive: input.isActive,
      }).$returningId();

      return { success: true, workflowId: workflow.id };
    }),

  /** Get workflows for an instance */
  getWorkflow: authedQuery
    .input(z.object({
      workflowId: z.number(),
    }))
    .query(async ({ input }) => {
      const [workflow] = await db.select().from(saasWorkflows)
        .where(eq(saasWorkflows.id, input.workflowId))
        .limit(1);
      return workflow || null;
    }),

  /** Add a role to an instance */
  addRole: authedQuery
    .input(z.object({
      instanceId: z.number(),
      name: z.string().min(1).max(255),
      permissions: z.array(z.string()),
      description: z.string().optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const [role] = await db.insert(saasRoles).values({
        instanceId: input.instanceId,
        name: input.name,
        permissions: input.permissions,
        description: input.description,
        isDefault: input.isDefault,
      }).$returningId();

      return { success: true, roleId: role.id };
    }),

  /** Get analytics for a SaaS instance */
  getAnalytics: authedQuery
    .input(z.object({
      instanceId: z.number(),
      merchantId: z.number(),
      days: z.number().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const [instance] = await db.select().from(saasInstances)
        .where(
          and(
            eq(saasInstances.id, input.instanceId),
            eq(saasInstances.merchantId, input.merchantId),
          ),
        )
        .limit(1);

      if (!instance) {
        return null;
      }

      // Get recent analytics entries for this merchant
      const metrics = await db.select().from(analytics)
        .where(eq(analytics.merchantId, input.merchantId))
        .orderBy(desc(analytics.date))
        .limit(input.days);

      return {
        instanceId: instance.id,
        name: instance.name,
        status: instance.status,
        deployedAt: instance.deployedAt,
        summary: instance.analyticsData,
        metrics: metrics.reduce((acc, m) => {
          if (!acc[m.metric]) acc[m.metric] = [];
          acc[m.metric].push({ date: m.date, value: m.value });
          return acc;
        }, {} as Record<string, Array<{ date: Date | null; value: number | null }>>),
      };
    }),
});
