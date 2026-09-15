import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { db } from "@db/queries/connection";
import { agentLogs } from "@db/schema";
import { eq, desc } from "drizzle-orm";

// ─── Agent Registry ────────────────────────────────────────────────────
interface AgentInfo {
  type: string;
  name: string;
  description: string;
  icon: string;
  capabilities: string[];
  marketCodes: string[];
  isActive: boolean;
}

const AGENT_REGISTRY: AgentInfo[] = [
  {
    type: "food", name: "جاسم طعام",
    description: "طلب وتوصيل الطعام من أفضل المطاعم",
    icon: "🍗",
    capabilities: ["food_order", "restaurant_discovery", "menu_browse", "delivery_tracking"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM"],
    isActive: true,
  },
  {
    type: "fashion", name: "جاسم موضة",
    description: "تسوق الملابس والإكسسوارات والموضة",
    icon: "👗",
    capabilities: ["product_search", "fashion_recommend", "size_guide", "virtual_try"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "EG"],
    isActive: true,
  },
  {
    type: "grocery", name: "جاسم بقالة",
    description: "توصيل البقالة والخضروات والفواكه",
    icon: "🛒",
    capabilities: ["grocery_order", "recipe_suggest", "pantry_restock", "fresh_delivery"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM"],
    isActive: true,
  },
  {
    type: "pharmacy", name: "جاسم صيدلية",
    description: "الأدوية والمستلزمات الصحية",
    icon: "💊",
    capabilities: ["pharmacy_order", "prescription_upload", "medicine_info", "health_tips"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "JO"],
    isActive: true,
  },
  {
    type: "fleet", name: "جاسم توصيل",
    description: "إدارة الأساطيل والسائقين والشحن",
    icon: "🚚",
    capabilities: ["order_tracking", "fleet_management", "route_optimize", "driver_assign"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "IQ"],
    isActive: true,
  },
  {
    type: "recruitment", name: "جاسم توظيف",
    description: "التوظيف وإدارة السير الذاتية والمقابلات",
    icon: "💼",
    capabilities: ["job_post", "cv_generate", "match_score", "interview_schedule"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "EG"],
    isActive: true,
  },
  {
    type: "b2b", name: "جاسم تجارة",
    description: "تجارة الجملة والموردين والاستيراد",
    icon: "🏭",
    capabilities: ["supplier_find", "bulk_order", "crossborder_trade", "murabaha"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "EG", "IQ"],
    isActive: true,
  },
  {
    type: "haggle", name: "جاسم مفاوض",
    description: "المفاوضة الذكية للحصول على أفضل الأسعار",
    icon: "💬",
    capabilities: ["price_negotiate", "deal_close", "bulk_discount", "auction"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM"],
    isActive: true,
  },
  {
    type: "smart_connect", name: "جاسم ربط",
    description: "ربط الأنظمة الخارجية والـ APIs",
    icon: "🔗",
    capabilities: ["pos_connect", "api_sync", "webhook_manage", "data_import"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM"],
    isActive: true,
  },
  {
    type: "gen_saas", name: "جاسم بناء",
    description: "بناء المنصات والمتاجر الإلكترونية",
    icon: "🏗",
    capabilities: ["deploy_store", "pos_setup", "theme_customize", "workflow_automation"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "EG"],
    isActive: true,
  },
  {
    type: "gen_aggregator", name: "جاسم سوق",
    description: "إنشاء أسواق متعددة البائعين",
    icon: "🏪",
    capabilities: ["marketplace_create", "vendor_onboard", "commission_set", "multi_vendor"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM"],
    isActive: true,
  },
  {
    type: "analytics", name: "جاسم تحليل",
    description: "تحليل البيانات والتقارير والرؤى",
    icon: "📊",
    capabilities: ["sales_report", "trend_analyze", "forecast", "dashboard_create"],
    marketCodes: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "EG"],
    isActive: true,
  },
];

// ─── In-memory active tasks (use Redis in production) ─────────────────
interface SwarmTask {
  id: string;
  agentType: string;
  input: Record<string, unknown>;
  priority: number;
  status: "queued" | "running" | "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

const activeTasks = new Map<string, SwarmTask>();

// ─── Mock swarm execution engine ───────────────────────────────────────
async function executeSwarmTask(task: Omit<SwarmTask, "id" | "status"> & { id?: string }): Promise<SwarmTask> {
  const id = task.id || `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const fullTask: SwarmTask = { ...task, id, status: "running", startedAt: new Date() };
  activeTasks.set(id, fullTask);

  // Simulate execution delay
  await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

  // Generate mock result based on agent type
  const agent = AGENT_REGISTRY.find(a => a.type === task.agentType);
  const result: Record<string, unknown> = {
    agentType: task.agentType,
    agentName: agent?.name || task.agentType,
    completed: true,
    timestamp: new Date().toISOString(),
    data: {
      ...task.input,
      processed: true,
      result: `تم تنفيذ المهمة بنجاح بواسطة ${agent?.name || task.agentType}`,
    },
  };

  fullTask.status = "completed";
  fullTask.result = result;
  fullTask.completedAt = new Date();
  activeTasks.set(id, fullTask);

  return fullTask;
}

// ─── SWARM ROUTER ──────────────────────────────────────────────────────
export const swarmRouter = router({

  // ═══════════════════════════════════════════════
  // Execute a swarm task (single)
  // ═══════════════════════════════════════════════
  execute: authedQuery
    .input(z.object({
      agentType: z.string().min(1),
      input: z.record(z.string(), z.any()),
      priority: z.number().default(1),
      parallel: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user!.id);
      const startTime = Date.now();

      const task = await executeSwarmTask({
        agentType: input.agentType,
        input: input.input,
        priority: input.priority,
      });

      // Log agent execution
      await db.insert(agentLogs).values({
        agentName: input.agentType,
        userId,
        input: JSON.stringify(input.input),
        output: JSON.stringify(task.result),
        duration: Date.now() - startTime,
      });

      return {
        taskId: task.id,
        status: task.status,
        result: task.result,
        agentType: input.agentType,
        duration: Date.now() - startTime,
      };
    }),

  // ═══════════════════════════════════════════════
  // Execute multiple swarm tasks
  // ═══════════════════════════════════════════════
  executeBatch: authedQuery
    .input(z.object({
      tasks: z.array(z.object({
        agentType: z.string().min(1),
        input: z.record(z.string(), z.any()),
        priority: z.number().default(1),
      })).min(1).max(10),
      parallel: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user!.id);
      const startTime = Date.now();

      let results: SwarmTask[];

      if (input.parallel) {
        results = await Promise.all(
          input.tasks.map(t => executeSwarmTask({
            agentType: t.agentType,
            input: t.input,
            priority: t.priority,
          })),
        );
      } else {
        results = [];
        for (const t of input.tasks) {
          const result = await executeSwarmTask({
            agentType: t.agentType,
            input: t.input,
            priority: t.priority,
          });
          results.push(result);
        }
      }

      // Log batch execution
      await db.insert(agentLogs).values({
        agentName: "swarm_batch",
        userId,
        input: JSON.stringify(input.tasks.map(t => t.agentType)),
        output: JSON.stringify(results.map(r => ({ id: r.id, status: r.status }))),
        duration: Date.now() - startTime,
      });

      return {
        totalTasks: results.length,
        completed: results.filter(r => r.status === "completed").length,
        failed: results.filter(r => r.status === "failed").length,
        duration: Date.now() - startTime,
        results: results.map(r => ({
          taskId: r.id,
          agentType: r.agentType,
          status: r.status,
          result: r.result,
          error: r.error,
        })),
      };
    }),

  // ═══════════════════════════════════════════════
  // Get available agents
  // ═══════════════════════════════════════════════
  listAgents: publicQuery
    .query(async () => {
      return {
        agents: AGENT_REGISTRY.map(a => ({
          type: a.type,
          name: a.name,
          description: a.description,
          icon: a.icon,
          capabilities: a.capabilities,
          markets: a.marketCodes,
          isActive: a.isActive,
        })),
        total: AGENT_REGISTRY.length,
      };
    }),

  // ═══════════════════════════════════════════════
  // Get agent status (load, availability)
  // ═══════════════════════════════════════════════
  agentStatus: authedQuery
    .input(z.object({ agentType: z.string() }))
    .query(async ({ input }) => {
      const agent = AGENT_REGISTRY.find(a => a.type === input.agentType);
      if (!agent) {
        return { status: "unknown" as const, load: 0, queue: 0, isActive: false };
      }

      // Count active tasks for this agent
      const agentTasks = Array.from(activeTasks.values())
        .filter(t => t.agentType === input.agentType && t.status === "running");

      return {
        status: agent.isActive ? "online" as const : "offline" as const,
        load: Math.min(agentTasks.length / 10, 1), // 0-1 scale
        queue: agentTasks.filter(t => t.status === "queued").length,
        isActive: agent.isActive,
        capabilities: agent.capabilities,
        markets: agent.marketCodes,
      };
    }),

  // ═══════════════════════════════════════════════
  // Get active swarm tasks
  // ═══════════════════════════════════════════════
  activeTasks: authedQuery
    .query(async () => {
      const tasks = Array.from(activeTasks.values())
        .filter(t => t.status === "running" || t.status === "queued");

      return {
        tasks: tasks.map(t => ({
          taskId: t.id,
          agentType: t.agentType,
          status: t.status,
          priority: t.priority,
          startedAt: t.startedAt,
        })),
        count: tasks.length,
      };
    }),

  // ═══════════════════════════════════════════════
  // Get task by ID
  // ═══════════════════════════════════════════════
  getTask: authedQuery
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      const task = activeTasks.get(input.taskId);
      if (!task) return { found: false as const };

      return {
        found: true as const,
        task: {
          taskId: task.id,
          agentType: task.agentType,
          status: task.status,
          priority: task.priority,
          result: task.result,
          error: task.error,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
        },
      };
    }),

  // ═══════════════════════════════════════════════
  // Route intent to best agent
  // ═══════════════════════════════════════════════
  routeIntent: authedQuery
    .input(z.object({
      intent: z.string(),
      marketCode: z.string().default("KW"),
    }))
    .query(async ({ input }) => {
      const intentAgentMap: Record<string, string> = {
        food_order: "food",
        product_search: "fashion",
        grocery_order: "grocery",
        pharmacy_order: "pharmacy",
        order_tracking: "fleet",
        job_seeker: "recruitment",
        hire_worker: "recruitment",
        create_store: "gen_saas",
        deploy_saas: "gen_saas",
        payment: "fashion",
        haggle: "haggle",
        smart_connect: "smart_connect",
        analytics: "analytics",
      };

      const agentType = intentAgentMap[input.intent] || "analytics";
      const agent = AGENT_REGISTRY.find(a => a.type === agentType);

      return {
        intent: input.intent,
        agentType,
        agentName: agent?.name || agentType,
        confidence: 0.92,
        marketSupport: agent?.marketCodes.includes(input.marketCode) ?? false,
      };
    }),

  // ═══════════════════════════════════════════════
  // Health check
  // ═══════════════════════════════════════════════
  health: publicQuery
    .query(() => {
      const onlineAgents = AGENT_REGISTRY.filter(a => a.isActive);
      return {
        status: "ok",
        agentsOnline: onlineAgents.length,
        totalAgents: AGENT_REGISTRY.length,
        activeTasks: Array.from(activeTasks.values()).filter(t => t.status === "running").length,
      };
    }),
});
