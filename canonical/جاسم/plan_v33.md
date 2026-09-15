# JASIM v33.1 — Plan de Construcción

## Visión
JASIM = Amazon + LinkedIn + Uber + Airbnb + Shopify + Fiverr en un solo producto.
No son 10 apps separadas. Es UNA plataforma con UN motor AI que genera los flows.

## Arquitectura Core (v34.1 — Unified)

```
User Layer (Web/WhatsApp/Voice)
  ↓
Intent Parser (AI Classification)
  ↓
DNA Router (8 Genes: UI/Capability/Trust/Memory/Reasoning/Planning/Communication/Security)
  ↓
Task Planner (DAG) — parallel/sequential/human-gate/fallback
  ↓
Capability Resolver + Cytoplasm (Shared Pool of 30+ Capabilities)
  ↓
Agent Composer (temporal execution context, NOT permanent agents)
  ↓
Trust Engine (Policy Engine) — revisa cada paso
  ↓
Runtime (Bubble UI Schema) — genera UI, no texto
  ↓
Billing Engine (post-execution, transparent)
```

## Fases

### Fase 1: Core Systems (Backend + DB + Frontend)
- Unified Database Schema (Listing-centric, 1 tabla para todo)
- DNA Router (8 genes, intent classification 14+ categorías)
- Cytoplasm (Capability Registry + 30+ adapters)
- Task Planner (DAG engine con dependencias, parallel, human gates)
- Agent Composer (genera execution contexts, no agents permanentes)
- Trust Engine (Policy Engine con KYC, Escrow, Islamic Validator)
- Runtime Schema (Bubble UI generador)
- Event Bus (Pub/Sub para cross-system events)
- Billing Engine (post-execution, transparente)

### Fase 2: Frontend (Web + PWA)
- GenUI Bubbles v5.0 (Schema-driven, no hardcoded)
- SwarmPanel (agentes vivos)
- Platform Windows (restaurant, car repair, jobs, realty, etc.)
- PWA config + Service Worker
- In-App Browser (sandboxed para pagos)

### Fase 3: Infrastructure
- Docker + Nginx + SSL
- tRPC routers (unified backend API)
- Drizzle schema migration

### Fase 4: Templates (20 قالب جاهز)
- Templates de plataformas SaaS pre-configuradas
- Template registry + loader

## Nuevos Archivos a Crear

### Backend Core (20+ archivos)
- `src/core/dna/` — DNA Router, Gene System, Breeding
- `src/core/cytoplasm/` — Capability Registry, Adapters, Tool Registry
- `src/core/planner/` — DAG Task Planner, Dependency Resolver
- `src/core/trust/` — Policy Engine, KYC, Escrow, Islamic Validator
- `src/core/runtime/` — Bubble Schema Generator, UI Schema Engine
- `src/core/billing/` — Billing Engine, Pricing Calculator
- `src/core/eventbus/` — Event Bus, Pub/Sub, Event Handlers
- `src/core/memory/` — Memory System (User/Conversation/Business)
- `src/core/permissions/` — Permission Engine, RBAC + Capabilities
- `src/core/secrets/` — Secrets Manager (Vault abstraction)
- `api/routers/unified.ts` — Router unificado para todos los flows
- `api/routers/listing.ts` — Listing CRUD + AI Tags + Search
- `api/routers/trust.ts` — KYC + Escrow + Reviews + Trust Score
- `api/routers/payment.ts` — KNET + Stripe + SADAD + Fawry + Escrow
- `api/routers/ads.ts` — Smart Listings + Boost + Campaigns
- `api/routers/saas.ts` — SaaS Builder + Template Engine
- `api/routers/ai.ts` — DeepSeek + Local Models + AI Engine
- `api/routers/billing.ts` — Billing + Pricing + Subscriptions
- `api/routers/fraud.ts` — Fraud Detection + Risk Score
- `api/routers/job.ts` — Jobs + CV + ATS + Matching
- `api/routers/realty.ts` — Real Estate + Mortgage Calculator
- `api/routers/healthcare.ts` — Healthcare + Pharmacy + Clinic
- `api/routers/travel.ts` — Travel + Umrah + Booking
- `api/routers/freelance.ts` — Freelance + Gig Economy
- `api/routers/event.ts` — Events + Venues + Booking
- `api/routers/gov.ts` — Government Services + Bills + Zakat

### Frontend (20+ archivos)
- `components/jasim-core/` — Runtime Renderer, Bubble Schema Parser
- `components/platform-windows/` — todas las ventanas de plataforma
- `components/swarm/` — SwarmPanel v2 + Living Agents
- `components/trust/` — KYC Wizard, Escrow UI, Trust Badge
- `components/payment/` — KNET Checkout, Escrow Dashboard
- `components/chat/` — AI Chat with Schema rendering
- `pages/Home.tsx` — página principal unificada
- `pages/PWA.tsx` — PWA entry point
- `hooks/useJasim.ts` — hook principal para DNA + Cytoplasm + Planner
- `hooks/useTrust.ts` — hook para Trust Engine
- `hooks/usePayment.ts` — hook para pagos
- `hooks/useEventBus.ts` — hook para eventos

### Database (schema additions)
- Unified `listings` table (reemplaza 10 tablas separadas)
- `listing_types` enum (PRODUCT, SERVICE, JOB, PROPERTY, BULK, EVENT, etc.)
- `ai_tags` table
- `trust_scores` table
- `escrow_transactions` table
- `kyc_verifications` table
- `reviews` table (unified)
- `billing_events` table
- `subscriptions` table
- `platform_templates` table (20 templates)
- `agent_contexts` table (execution contexts temporales)
- `task_dags` table (planes de ejecución)
- `events` table (Event Bus log)
- `capabilities` table (registry de capabilities)
- `capability_adapters` table (adapters para APIs externas)

### Infrastructure
- `docker-compose.yml` — Docker + Nginx + MySQL + Redis + App
- `nginx.conf` — Nginx config with SSL + PWA + caching
- `Dockerfile` — Multi-stage build
- `manifest.json` — PWA manifest
- `service-worker.ts` — Service Worker for PWA

## Estrategia de Ejecución
- Usar MODE A (multi-agent) por la complejidad
- Subagentes paralelos para cada módulo
- Git worktrees para aislamiento
- Integration final por el agente principal

## Tiempo Estimado
- Fase 1: 3-4 rondas de subagentes
- Fase 2: 2-3 rondas
- Fase 3: 1 ronda
- Fase 4: 1 ronda
- Total: 8-10 rondas de agentes
