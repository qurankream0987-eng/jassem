import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  float,
  json,
  boolean,
  bigint,
} from "drizzle-orm/mysql-core";

// ============================================
// CORE: Users (from auth, extended)
// ============================================
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  phone: varchar("phone", { length: 20 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  market: varchar("market", { length: 10 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

// ============================================
// MARKETS: 15 Arab countries
// ============================================
export const markets = mysqlTable("markets", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 5 }).notNull().unique(),
  nameAr: varchar("nameAr", { length: 100 }).notNull(),
  nameEn: varchar("nameEn", { length: 100 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  currencySymbol: varchar("currencySymbol", { length: 10 }).notNull(),
  isActive: boolean("isActive").default(true),
  pricingMultiplier: float("pricingMultiplier").default(1.0),
});

// ============================================
// MERCHANTS: Store owners / businesses
// ============================================
export const merchants = mysqlTable("merchants", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  businessName: varchar("businessName", { length: 255 }).notNull(),
  businessType: mysqlEnum("businessType", [
    "restaurant", "pharmacy", "clothing", "grocery",
    "electronics", "salon", "real_estate", "workshop",
    "bookstore", "wholesale", "clinic", "other"
  ]).notNull(),
  crNumber: varchar("crNumber", { length: 50 }),
  licenseUrl: text("licenseUrl"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  subscriptionTier: mysqlEnum("subscriptionTier", [
    "starter", "pro", "enterprise", "ultimate"
  ]).default("starter"),
  commissionRate: float("commissionRate").default(0.025),
  isVerified: boolean("isVerified").default(false),
  isActive: boolean("isActive").default(true),
  kycStatus: mysqlEnum("kycStatus", ["pending", "approved", "rejected"]).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// PRODUCTS: Catalog items
// ============================================
export const products = mysqlTable("products", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  price: float("price").notNull(),
  currency: varchar("currency", { length: 10 }).default("KWD"),
  category: varchar("category", { length: 100 }),
  imageUrl: text("imageUrl"),
  stock: int("stock").default(0),
  isHalal: boolean("isHalal").default(true),
  barcode: varchar("barcode", { length: 50 }),
  tags: json("tags").$type<string[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// ORDERS: Purchase orders
// ============================================
export const orders = mysqlTable("orders", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  productIds: json("productIds").$type<number[]>().notNull(),
  totalAmount: float("totalAmount").notNull(),
  commission: float("commission").default(0),
  status: mysqlEnum("status", [
    "pending", "confirmed", "processing", "shipped",
    "delivered", "cancelled", "returned"
  ]).default("pending"),
  paymentMethod: varchar("paymentMethod", { length: 50 }),
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "failed", "refunded"]).default("pending"),
  escrowStatus: mysqlEnum("escrowStatus", ["holding", "released", "disputed"]).default("holding"),
  trackingNumber: varchar("trackingNumber", { length: 100 }),
  deliveryEta: timestamp("deliveryEta"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// CHATS: Chat sessions
// ============================================
export const chats = mysqlTable("chats", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }),
  intent: varchar("intent", { length: 50 }),
  context: json("context").$type<Record<string, unknown>>(),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// MESSAGES: Individual chat messages
// ============================================
export const messages = mysqlTable("messages", {
  id: serial("id").primaryKey(),
  chatId: bigint("chatId", { mode: "number", unsigned: true }).notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  intent: varchar("intent", { length: 50 }),
  bubbleData: json("bubbleData").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// CANDIDATES: Job seekers
// ============================================
export const candidates = mysqlTable("candidates", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  fullName: varchar("fullName", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  title: varchar("title", { length: 100 }).notNull(),
  summary: text("summary"),
  skills: json("skills").$type<string[]>().notNull(),
  experience: int("experience").default(0),
  education: varchar("education", { length: 255 }),
  cvUrl: text("cvUrl"),
  aiScore: int("aiScore").default(0),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  isAvailable: boolean("isAvailable").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// JOB_POSTS: Posted jobs
// ============================================
export const jobPosts = mysqlTable("job_posts", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  requirements: json("requirements").$type<string[]>().notNull(),
  skills: json("skills").$type<string[]>().notNull(),
  salaryMin: float("salaryMin"),
  salaryMax: float("salaryMax"),
  currency: varchar("currency", { length: 10 }).default("KWD"),
  jobType: mysqlEnum("jobType", ["full_time", "part_time", "contract", "freelance"]).default("full_time"),
  level: mysqlEnum("level", ["entry", "mid", "senior", "lead"]).default("mid"),
  location: varchar("location", { length: 255 }),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  isActive: boolean("isActive").default(true),
  viewCount: int("viewCount").default(0),
  applyCount: int("applyCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// JOB_APPLICATIONS: Applications linking candidates to jobs
// ============================================
export const jobApplications = mysqlTable("job_applications", {
  id: serial("id").primaryKey(),
  jobId: bigint("jobId", { mode: "number", unsigned: true }).notNull(),
  candidateId: bigint("candidateId", { mode: "number", unsigned: true }).notNull(),
  matchScore: int("matchScore").default(0),
  coverLetter: text("coverLetter"),
  status: mysqlEnum("status", ["pending", "reviewing", "accepted", "rejected"]).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// MEMORY: AI memory/preferences per user
// ============================================
export const memory = mysqlTable("memory", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  key: varchar("key", { length: 100 }).notNull(),
  value: text("value").notNull(),
  category: varchar("category", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// BUBBLES: Generated bubble instances
// ============================================
export const bubbles = mysqlTable("bubbles", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  data: json("data").$type<Record<string, unknown>>(),
  color: varchar("color", { length: 20 }),
  color2: varchar("color2", { length: 20 }),
  isPinned: boolean("isPinned").default(false),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// DNA_GENOMES: DNA breeding system
// ============================================
export const dnaGenomes = mysqlTable("dna_genomes", {
  id: serial("id").primaryKey(),
  parent1Id: bigint("parent1Id", { mode: "number", unsigned: true }),
  parent2Id: bigint("parent2Id", { mode: "number", unsigned: true }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  genes: json("genes").$type<Record<string, number>>().notNull(),
  perception: int("perception").default(50),
  action: int("action").default(50),
  validation: int("validation").default(50),
  integration: int("integration").default(50),
  uiGen: int("uiGen").default(50),
  memory: int("memory").default(50),
  payment: int("payment").default(50),
  analytics: int("analytics").default(50),
  compliance: int("compliance").default(50),
  security: int("security").default(50),
  learning: int("learning").default(50),
  scale: int("scale").default(50),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// ANALYTICS: User/business analytics
// ============================================
export const analytics = mysqlTable("analytics", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }),
  date: timestamp("date").defaultNow().notNull(),
  metric: varchar("metric", { length: 50 }).notNull(),
  value: float("value").default(0),
  category: varchar("category", { length: 50 }),
});

// ============================================
// AGENT_LOGS: AI agent execution logs
// ============================================
export const agentLogs = mysqlTable("agent_logs", {
  id: serial("id").primaryKey(),
  agentName: varchar("agentName", { length: 100 }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  intent: varchar("intent", { length: 50 }),
  input: text("input"),
  output: text("output"),
  tokensUsed: int("tokensUsed").default(0),
  cost: float("cost").default(0),
  duration: int("duration").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// ADS: Advertising campaigns
// ============================================
export const ads = mysqlTable("ads", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  imageUrl: text("imageUrl"),
  targetMarket: varchar("targetMarket", { length: 5 }).default("KW"),
  budget: float("budget").default(0),
  spent: float("spent").default(0),
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  conversions: int("conversions").default(0),
  status: mysqlEnum("status", ["active", "paused", "ended"]).default("active"),
  startDate: timestamp("startDate").defaultNow(),
  endDate: timestamp("endDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// RETURNS: Smart return system
// ============================================
export const returns = mysqlTable("returns", {
  id: serial("id").primaryKey(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  reason: text("reason").notNull(),
  imageUrl: text("imageUrl"),
  aiAnalysis: text("aiAnalysis"),
  resolution: mysqlEnum("resolution", [
    "replace", "credit", "refund", "discount", "investigate"
  ]),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "resolved"]).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

// ============================================
// SMART_CONNECT: Connected POS/API systems
// ============================================
export const connectedSystems = mysqlTable("connected_systems", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  systemType: mysqlEnum("systemType", [
    "toast", "square", "clover", "shopify", "woocommerce",
    "magento", "stripe", "paypal", "custom_api", "other",
  ]).notNull(),
  apiEndpoint: varchar("apiEndpoint", { length: 500 }),
  apiKey: varchar("apiKey", { length: 500 }),
  apiSecret: varchar("apiSecret", { length: 500 }),
  webhookUrl: varchar("webhookUrl", { length: 500 }),
  config: json("config").$type<Record<string, unknown>>(),
  lastSyncAt: timestamp("lastSyncAt"),
  syncStatus: mysqlEnum("syncStatus", ["idle", "syncing", "error", "success"]).default("idle"),
  isActive: boolean("isActive").default(true),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// API_MAPPINGS: Field mappings for API integrations
// ============================================
export const apiMappings = mysqlTable("api_mappings", {
  id: serial("id").primaryKey(),
  systemId: bigint("systemId", { mode: "number", unsigned: true }).notNull(),
  sourceField: varchar("sourceField", { length: 255 }).notNull(),
  targetField: varchar("targetField", { length: 255 }).notNull(),
  transformRule: varchar("transformRule", { length: 255 }),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// SYNC_LOGS: Data sync operation logs
// ============================================
export const syncLogs = mysqlTable("sync_logs", {
  id: serial("id").primaryKey(),
  systemId: bigint("systemId", { mode: "number", unsigned: true }).notNull(),
  operation: varchar("operation", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["success", "error", "warning"]).default("success"),
  recordsCount: int("recordsCount").default(0),
  details: text("details"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

// ============================================
// WEBHOOKS: Registered webhook endpoints
// ============================================
export const webhooks = mysqlTable("webhooks", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  events: json("events").$type<string[]>().notNull(),
  secret: varchar("secret", { length: 255 }),
  isActive: boolean("isActive").default(true),
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  failureCount: int("failureCount").default(0),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// WEBHOOK_DELIVERY_LOGS: Webhook delivery history
// ============================================
export const webhookDeliveryLogs = mysqlTable("webhook_delivery_logs", {
  id: serial("id").primaryKey(),
  webhookId: bigint("webhookId", { mode: "number", unsigned: true }).notNull(),
  event: varchar("event", { length: 100 }).notNull(),
  payload: json("payload").$type<Record<string, unknown>>(),
  responseStatus: int("responseStatus"),
  responseBody: text("responseBody"),
  status: mysqlEnum("status", ["delivered", "failed", "retrying"]).default("delivered"),
  attempt: int("attempt").default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// SAAS_TEMPLATES: Gen-SaaS platform templates
// ============================================
export const saasTemplates = mysqlTable("saas_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  category: varchar("category", { length: 100 }).notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  features: json("features").$type<string[]>(),
  defaultConfig: json("defaultConfig").$type<Record<string, unknown>>(),
  pricingMonthly: float("pricingMonthly").default(0),
  pricingYearly: float("pricingYearly").default(0),
  isActive: boolean("isActive").default(true),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// SAAS_INSTANCES: Deployed SaaS instances
// ============================================
export const saasInstances = mysqlTable("saas_instances", {
  id: serial("id").primaryKey(),
  templateId: bigint("templateId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  subdomain: varchar("subdomain", { length: 100 }).unique(),
  customDomain: varchar("customDomain", { length: 255 }).unique(),
  status: mysqlEnum("status", ["deploying", "active", "suspended", "terminated"]).default("deploying"),
  config: json("config").$type<Record<string, unknown>>(),
  analyticsData: json("analyticsData").$type<Record<string, number>>(),
  deployedAt: timestamp("deployedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  lastDeployedAt: timestamp("lastDeployedAt"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// SAAS_WORKFLOWS: Instance workflow configurations
// ============================================
export const saasWorkflows = mysqlTable("saas_workflows", {
  id: serial("id").primaryKey(),
  instanceId: bigint("instanceId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  trigger: varchar("trigger", { length: 100 }).notNull(),
  actions: json("actions").$type<Array<Record<string, unknown>>>().notNull(),
  isActive: boolean("isActive").default(true),
  executionCount: int("executionCount").default(0),
  lastExecutedAt: timestamp("lastExecutedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// SAAS_ROLES: Instance role-based access
// ============================================
export const saasRoles = mysqlTable("saas_roles", {
  id: serial("id").primaryKey(),
  instanceId: bigint("instanceId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  permissions: json("permissions").$type<string[]>().notNull(),
  description: text("description"),
  isDefault: boolean("isDefault").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// AGGREGATOR_PLATFORMS: Multi-vendor marketplace platforms
// ============================================
export const aggregatorPlatforms = mysqlTable("aggregator_platforms", {
  id: serial("id").primaryKey(),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  logoUrl: text("logoUrl"),
  theme: json("theme").$type<Record<string, string>>(),
  commissionGlobal: float("commissionGlobal").default(0.1),
  vendorApprovalMode: mysqlEnum("vendorApprovalMode", ["auto", "manual"]).default("manual"),
  status: mysqlEnum("status", ["setup", "active", "paused", "closed"]).default("setup"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  analyticsSnapshot: json("analyticsSnapshot").$type<Record<string, number>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// AGGREGATOR_VENDORS: Vendors on a platform
// ============================================
export const aggregatorVendors = mysqlTable("aggregator_vendors", {
  id: serial("id").primaryKey(),
  platformId: bigint("platformId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  commissionRate: float("commissionRate").default(0.1),
  isApproved: boolean("isApproved").default(false),
  status: mysqlEnum("status", ["pending", "active", "suspended", "removed"]).default("pending"),
  productCount: int("productCount").default(0),
  orderCount: int("orderCount").default(0),
  revenue: float("revenue").default(0),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

// ============================================
// WIDGETS: Embedded widget configurations
// ============================================
export const widgets = mysqlTable("widgets", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  widgetType: mysqlEnum("widgetType", [
    "chat", "booking", "product_carousel", "review",
    "payment_button", "lead_form", "availability", "custom",
  ]).notNull(),
  config: json("config").$type<Record<string, unknown>>().notNull(),
  appearance: json("appearance").$type<Record<string, string>>(),
  allowedDomains: json("allowedDomains").$type<string[]>(),
  embedToken: varchar("embedToken", { length: 255 }).notNull().unique(),
  isActive: boolean("isActive").default(true),
  impressionCount: int("impressionCount").default(0),
  interactionCount: int("interactionCount").default(0),
  conversionCount: int("conversionCount").default(0),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// WIDGET_EVENTS: Widget usage analytics events
// ============================================
export const widgetEvents = mysqlTable("widget_events", {
  id: serial("id").primaryKey(),
  widgetId: bigint("widgetId", { mode: "number", unsigned: true }).notNull(),
  eventType: varchar("eventType", { length: 50 }).notNull(),
  sessionId: varchar("sessionId", { length: 255 }),
  url: varchar("url", { length: 500 }),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// A2A_AGENTS: Agents available for trading
// ============================================
export const a2aAgents = mysqlTable("a2a_agents", {
  id: serial("id").primaryKey(),
  ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  agentType: mysqlEnum("agentType", [
    "trading", "negotiation", "customer_service",
    "analytics", "marketing", "custom",
  ]).notNull(),
  skills: json("skills").$type<string[]>().notNull(),
  personality: json("personality").$type<Record<string, number>>(),
  trainingData: text("trainingData"),
  isListed: boolean("isListed").default(false),
  listingPrice: float("listingPrice"),
  isForTrade: boolean("isForTrade").default(false),
  tradePreferences: json("tradePreferences").$type<Record<string, unknown>>(),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  reputation: int("reputation").default(0),
  transactionCount: int("transactionCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// A2A_LISTINGS: Agent sale/trade listings
// ============================================
export const a2aListings = mysqlTable("a2a_listings", {
  id: serial("id").primaryKey(),
  agentId: bigint("agentId", { mode: "number", unsigned: true }).notNull(),
  sellerId: bigint("sellerId", { mode: "number", unsigned: true }).notNull(),
  listingType: mysqlEnum("listingType", ["sale", "trade", "auction"]).notNull(),
  price: float("price"),
  startingBid: float("startingBid"),
  currentBid: float("currentBid"),
  highestBidderId: bigint("highestBidderId", { mode: "number", unsigned: true }),
  tradeFor: json("tradeFor").$type<string[]>(),
  description: text("description"),
  status: mysqlEnum("status", ["active", "sold", "cancelled", "expired"]).default("active"),
  expiresAt: timestamp("expiresAt"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// A2A_TRANSACTIONS: Agent purchase/trade transactions
// ============================================
export const a2aTransactions = mysqlTable("a2a_transactions", {
  id: serial("id").primaryKey(),
  agentId: bigint("agentId", { mode: "number", unsigned: true }).notNull(),
  listingId: bigint("listingId", { mode: "number", unsigned: true }).notNull(),
  buyerId: bigint("buyerId", { mode: "number", unsigned: true }).notNull(),
  sellerId: bigint("sellerId", { mode: "number", unsigned: true }).notNull(),
  transactionType: mysqlEnum("transactionType", ["purchase", "trade", "auction_win"]).notNull(),
  amount: float("amount").default(0),
  tradeDetails: json("tradeDetails").$type<Record<string, unknown>>(),
  escrowStatus: mysqlEnum("escrowStatus", ["holding", "released", "disputed", "refunded"]).default("holding"),
  status: mysqlEnum("status", ["pending", "completed", "cancelled", "disputed"]).default("pending"),
  completedAt: timestamp("completedAt"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// A2A_NEGOTIATIONS: Price negotiations between agents
// ============================================
export const a2aNegotiations = mysqlTable("a2a_negotiations", {
  id: serial("id").primaryKey(),
  listingId: bigint("listingId", { mode: "number", unsigned: true }).notNull(),
  buyerId: bigint("buyerId", { mode: "number", unsigned: true }).notNull(),
  sellerId: bigint("sellerId", { mode: "number", unsigned: true }).notNull(),
  initialPrice: float("initialPrice").notNull(),
  offeredPrice: float("offeredPrice").notNull(),
  counterPrice: float("counterPrice"),
  finalPrice: float("finalPrice"),
  messages: json("messages").$type<Array<Record<string, unknown>>>(),
  status: mysqlEnum("status", ["pending", "accepted", "rejected", "countered", "expired"]).default("pending"),
  expiresAt: timestamp("expiresAt"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// Type exports
export type User = typeof users.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type JobPost = typeof jobPosts.$inferSelect;
export type JobApplication = typeof jobApplications.$inferSelect;
export type Memory = typeof memory.$inferSelect;
export type Bubble = typeof bubbles.$inferSelect;
export type DNAGenome = typeof dnaGenomes.$inferSelect;
export type Analytics = typeof analytics.$inferSelect;
export type AgentLog = typeof agentLogs.$inferSelect;
export type Ad = typeof ads.$inferSelect;
export type Return = typeof returns.$inferSelect;
export type ConnectedSystem = typeof connectedSystems.$inferSelect;
export type ApiMapping = typeof apiMappings.$inferSelect;
export type SyncLog = typeof syncLogs.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDeliveryLog = typeof webhookDeliveryLogs.$inferSelect;
export type SaasTemplate = typeof saasTemplates.$inferSelect;
export type SaasInstance = typeof saasInstances.$inferSelect;
export type SaasWorkflow = typeof saasWorkflows.$inferSelect;
export type SaasRole = typeof saasRoles.$inferSelect;
export type AggregatorPlatform = typeof aggregatorPlatforms.$inferSelect;
export type AggregatorVendor = typeof aggregatorVendors.$inferSelect;
export type Widget = typeof widgets.$inferSelect;
export type WidgetEvent = typeof widgetEvents.$inferSelect;
export type A2AAgent = typeof a2aAgents.$inferSelect;
export type A2AListing = typeof a2aListings.$inferSelect;
export type A2ATransaction = typeof a2aTransactions.$inferSelect;
export type A2ANegotiation = typeof a2aNegotiations.$inferSelect;
export const drivers = mysqlTable("drivers", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  fullName: varchar("fullName", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 320 }),
  vehicleType: mysqlEnum("vehicleType", ["motorcycle", "car", "van", "truck", "bicycle"]).default("car").notNull(),
  vehicleModel: varchar("vehicleModel", { length: 100 }),
  vehiclePlate: varchar("vehiclePlate", { length: 50 }),
  licenseNumber: varchar("licenseNumber", { length: 50 }),
  status: mysqlEnum("status", ["available", "busy", "offline", "suspended"]).default("offline").notNull(),
  currentLat: float("currentLat"),
  currentLng: float("currentLng"),
  lastLocationAt: timestamp("lastLocationAt"),
  rating: float("rating").default(5.0),
  totalDeliveries: int("totalDeliveries").default(0),
  totalEarnings: float("totalEarnings").default(0),
  commissionRate: float("commissionRate").default(0.15),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const driverAssignments = mysqlTable("driver_assignments", {
  id: serial("id").primaryKey(),
  driverId: bigint("driverId", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["assigned", "accepted", "picked_up", "in_transit", "delivered", "cancelled"]).default("assigned").notNull(),
  routeData: json("routeData").$type<{ lat: number; lng: number; timestamp: string }[]>(),
  estimatedMinutes: int("estimatedMinutes"),
  actualMinutes: int("actualMinutes"),
  commission: float("commission").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const sosAlerts = mysqlTable("sos_alerts", {
  id: serial("id").primaryKey(),
  driverId: bigint("driverId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["accident", "theft", "harassment", "mechanical", "medical", "other"]).default("other").notNull(),
  message: text("message"),
  lat: float("lat"),
  lng: float("lng"),
  status: mysqlEnum("status", ["active", "resolved", "escalated"]).default("active").notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// ZAKAT: Islamic zakat calculations
// ============================================
export const zakatCalculations = mysqlTable("zakat_calculations", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  yearHijri: int("yearHijri").notNull(),
  nisabThreshold: float("nisabThreshold").notNull(),
  totalAssets: float("totalAssets").default(0),
  totalLiabilities: float("totalLiabilities").default(0),
  netWealth: float("netWealth").default(0),
  zakatPayable: float("zakatPayable").default(0),
  zakatRate: float("zakatRate").default(0.025),
  goldPriceGram: float("goldPriceGram"),
  silverPriceGram: float("silverPriceGram"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  currency: varchar("currency", { length: 10 }).default("KWD"),
  status: mysqlEnum("status", ["draft", "confirmed", "paid"]).default("draft").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const zakatAssets = mysqlTable("zakat_assets", {
  id: serial("id").primaryKey(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  calculationId: bigint("calculationId", { mode: "number", unsigned: true }),
  assetType: mysqlEnum("assetType", [
    "cash", "gold", "silver", "inventory", "receivables",
    "investments", "real_estate", "crypto", "business_assets", "other"
  ]).notNull(),
  description: varchar("description", { length: 255 }),
  value: float("value").notNull(),
  quantity: float("quantity"),
  unitPrice: float("unitPrice"),
  isZakatable: boolean("isZakatable").default(true),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// BIOMETRIC: Face/touch biometric enrollments
// ============================================
export const biometricEnrollments = mysqlTable("biometric_enrollments", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["face", "fingerprint", "iris", "voice"]).notNull(),
  templateHash: varchar("templateHash", { length: 512 }).notNull(),
  templateData: text("templateData"),
  livenessScore: float("livenessScore"),
  spoofAttempts: int("spoofAttempts").default(0),
  isVerified: boolean("isVerified").default(false),
  isActive: boolean("isActive").default(true),
  lastVerifiedAt: timestamp("lastVerifiedAt"),
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// VISION: AI vision scan logs
// ============================================
export const visionScans = mysqlTable("vision_scans", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }),
  scanType: mysqlEnum("scanType", [
    "product_scan", "document_verification", "image_search",
    "receipt_ocr", "object_detection", "barcode_scan"
  ]).notNull(),
  imageUrl: text("imageUrl"),
  result: json("result").$type<Record<string, unknown>>(),
  confidence: float("confidence"),
  ocrText: text("ocrText"),
  detectedObjects: json("detectedObjects").$type<Array<{ label: string; confidence: number; bbox: number[] }>>(),
  status: mysqlEnum("status", ["processing", "completed", "failed"]).default("processing").notNull(),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// VOICE: AI voice session logs
// ============================================
export const voiceSessions = mysqlTable("voice_sessions", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }),
  sessionType: mysqlEnum("sessionType", ["transcription", "synthesis", "dialect_detection", "dna_query"]).notNull(),
  inputText: text("inputText"),
  outputText: text("outputText"),
  audioUrl: text("audioUrl"),
  detectedDialect: varchar("detectedDialect", { length: 50 }),
  confidence: float("confidence"),
  language: varchar("language", { length: 10 }).default("ar"),
  durationMs: int("durationMs"),
  modelUsed: varchar("modelUsed", { length: 100 }),
  bubbleType: varchar("bubbleType", { length: 50 }),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Type exports

// ============================================
// CART_ITEMS: Shopping cart items
// ============================================
export const cartItems = mysqlTable("cart_items", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  marketId: varchar("marketId", { length: 10 }).notNull(),
  productId: bigint("productId", { mode: "number", unsigned: true }).notNull(),
  quantity: int("quantity").notNull().default(1),
  variantId: bigint("variantId", { mode: "number", unsigned: true }),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// PAYMENTS: Payment records
// ============================================
export const payments = mysqlTable("payments", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }),
  amount: float("amount").notNull(),
  currency: varchar("currency", { length: 10 }).default("KWD"),
  gateway: mysqlEnum("gateway", ["knet", "apple_pay", "google_pay", "cash", "card"]).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed", "refunded"]).default("pending"),
  escrowStatus: mysqlEnum("escrowStatus", ["holding", "released", "disputed", "refunded"]).default("holding"),
  transactionRef: varchar("transactionRef", { length: 255 }),
  biometricVerified: boolean("biometricVerified").default(false),
  refundAmount: float("refundAmount").default(0),
  refundReason: text("refundReason"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// SUPPLIERS: B2B suppliers
// ============================================
export const suppliers = mysqlTable("suppliers", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  businessName: varchar("businessName", { length: 255 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  country: varchar("country", { length: 5 }).default("KW"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  businessType: mysqlEnum("businessType", [
    "manufacturer", "distributor", "wholesaler", "importer", "exporter", "other"
  ]).default("other"),
  kycStatus: mysqlEnum("kycStatus", ["pending", "approved", "rejected"]).default("pending"),
  isVerified: boolean("isVerified").default(false),
  isActive: boolean("isActive").default(true),
  productCount: int("productCount").default(0),
  rating: float("rating").default(5.0),
  totalOrders: int("totalOrders").default(0),
  totalRevenue: float("totalRevenue").default(0),
  documents: json("documents").$type<Record<string, string>[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// CROSSBORDER_ORDERS: Cross-border B2B orders
// ============================================
export const crossborderOrders = mysqlTable("crossborder_orders", {
  id: serial("id").primaryKey(),
  buyerId: bigint("buyerId", { mode: "number", unsigned: true }).notNull(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }).notNull(),
  productIds: json("productIds").$type<number[]>().notNull(),
  totalAmount: float("totalAmount").notNull(),
  currency: varchar("currency", { length: 10 }).default("KWD"),
  customsFees: float("customsFees").default(0),
  shippingFees: float("shippingFees").default(0),
  murabahaRate: float("murabahaRate").default(0),
  murabahaAmount: float("murabahaAmount").default(0),
  totalCost: float("totalCost").notNull(),
  status: mysqlEnum("status", [
    "draft", "proforma", "confirmed", "customs_processing",
    "in_transit", "arrived", "delivered", "cancelled"
  ]).default("draft"),
  trackingStage: mysqlEnum("trackingStage", [
    "order_placed", "payment_received", "customs_cleared", "origin_shipped",
    "in_transit", "destination_arrived", "delivered"
  ]).default("order_placed"),
  originCountry: varchar("originCountry", { length: 5 }).notNull(),
  destinationCountry: varchar("destinationCountry", { length: 5 }).notNull(),
  tradeDocumentUrls: json("tradeDocumentUrls").$type<Record<string, string>>(),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// HAGGLE_SESSIONS: AI negotiation sessions
// ============================================
export const haggleSessions = mysqlTable("haggle_sessions", {
  id: serial("id").primaryKey(),
  buyerId: bigint("buyerId", { mode: "number", unsigned: true }).notNull(),
  merchantId: bigint("merchantId", { mode: "number", unsigned: true }).notNull(),
  productId: bigint("productId", { mode: "number", unsigned: true }).notNull(),
  originalPrice: float("originalPrice").notNull(),
  currentPrice: float("currentPrice").notNull(),
  finalPrice: float("finalPrice"),
  concessionRange: json("concessionRange").$type<{ min: number; max: number }>(),
  status: mysqlEnum("status", ["active", "accepted", "rejected", "expired"]).default("active"),
  expiresAt: timestamp("expiresAt"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// HAGGLE_OFFERS: Individual haggle offers
// ============================================
export const haggleOffers = mysqlTable("haggle_offers", {
  id: serial("id").primaryKey(),
  sessionId: bigint("sessionId", { mode: "number", unsigned: true }).notNull(),
  offeredBy: mysqlEnum("offeredBy", ["buyer", "ai", "merchant"]).notNull(),
  offerPrice: float("offerPrice").notNull(),
  counterPrice: float("counterPrice"),
  message: text("message"),
  concessionPercent: float("concessionPercent").default(0),
  isAccepted: boolean("isAccepted").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// NISAB_SETTINGS: Nisab thresholds per market
// ============================================
export const nisabSettings = mysqlTable("nisab_settings", {
  id: serial("id").primaryKey(),
  marketCode: varchar("marketCode", { length: 5 }).notNull(),
  goldPriceGram: float("goldPriceGram").notNull(),
  silverPriceGram: float("silverPriceGram").notNull(),
  goldNisabGrams: float("goldNisabGrams").default(85),
  silverNisabGrams: float("silverNisabGrams").default(595),
  nisabThreshold: float("nisabThreshold").notNull(),
  currency: varchar("currency", { length: 10 }).default("KWD"),
  effectiveDate: timestamp("effectiveDate").defaultNow().notNull(),
  updatedBy: bigint("updatedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// ============================================
// ISLAMIC_PRODUCT_CHECKS: Halal compliance checks
// ============================================
export const islamicProductChecks = mysqlTable("islamic_product_checks", {
  id: serial("id").primaryKey(),
  productId: bigint("productId", { mode: "number", unsigned: true }).notNull(),
  productName: varchar("productName", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  tags: json("tags").$type<string[]>(),
  isHalal: boolean("isHalal").default(true),
  confidence: float("confidence").default(1.0),
  flaggedIngredients: json("flaggedIngredients").$type<string[]>(),
  checkMethod: mysqlEnum("checkMethod", ["scan", "manual", "ai_analysis"]).default("scan"),
  marketCode: varchar("marketCode", { length: 5 }).default("KW"),
  verifiedBy: bigint("verifiedBy", { mode: "number", unsigned: true }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// Type exports (Commerce)
export type CartItem = typeof cartItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type CrossborderOrder = typeof crossborderOrders.$inferSelect;
export type HaggleSession = typeof haggleSessions.$inferSelect;
export type HaggleOffer = typeof haggleOffers.$inferSelect;
// ============================================
// NOTIFICATIONS: In-app notification store
// ============================================
export const notifications = mysqlTable("notifications", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  body: text("body").notNull(),
  data: json("data").$type<Record<string, unknown>>(),
  urgency: mysqlEnum("urgency", ["normal", "high", "critical"]).default("normal").notNull(),
  channels: json("channels").$type<string[]>().default([]),
  read: boolean("read").default(false),
  readAt: timestamp("readAt"),
  actionUrl: text("actionUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// DEVICE TOKENS: FCM/APNs push tokens per user
// ============================================
export const deviceTokens = mysqlTable("device_tokens", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  token: varchar("token", { length: 500 }).notNull(),
  platform: mysqlEnum("platform", ["android", "ios", "web"]).notNull(),
  isActive: boolean("isActive").default(true),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// DELIVERY LOGS: Notification delivery tracking
// ============================================
export const deliveryLogs = mysqlTable("delivery_logs", {
  id: serial("id").primaryKey(),
  notificationId: bigint("notificationId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  channel: mysqlEnum("channel", ["push", "whatsapp", "sms", "email", "in_app"]).notNull(),
  status: mysqlEnum("status", ["pending", "delivered", "failed", "bounced"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  providerResponse: text("providerResponse"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// USER PREFERENCES: Notification preferences per user
// ============================================
export const notificationPreferences = mysqlTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull().unique(),
  inApp: boolean("inApp").default(true),
  push: boolean("push").default(true),
  whatsapp: boolean("whatsapp").default(true),
  sms: boolean("sms").default(true),
  email: boolean("email").default(true),
  marketingEmails: boolean("marketingEmails").default(true),
  quietHoursStart: int("quietHoursStart"),
  quietHoursEnd: int("quietHoursEnd"),
  language: varchar("language", { length: 10 }).default("ar"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

// Type exports
export type NisabSetting = typeof nisabSettings.$inferSelect;
export type IslamicProductCheck = typeof islamicProductChecks.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type DeliveryLog = typeof deliveryLogs.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
