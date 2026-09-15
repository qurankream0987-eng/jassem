# خطة بناء عقل جاسم — JASIM Core & Swarm Architecture

## 1. رؤية العقل

جاسم = OS Marketplace + Executive AI Agent + Swarm System

```
┌─────────────────────────────────────────────────────────────────────┐
│                    عقل جاسم — JASIM BRAIN                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   INPUT      │───▶│    CORE      │───▶│   OUTPUT     │          │
│  │   LAYER      │    │   ENGINE     │    │   LAYER      │          │
│  └──────────────┘    └──────┬───────┘    └──────────────┘          │
│                             │                                       │
│              ┌──────────────┼──────────────┐                       │
│              ▼              ▼              ▼                       │
│       ┌──────────┐  ┌──────────┐  ┌──────────┐                    │
│       │  SWARM   │  │  MEMORY  │  │ CONTEXT  │                    │
│       │ ORCH.    │  │ ENGINE   │  │ BUILDER  │                    │
│       └────┬─────┘  └──────────┘  └──────────┘                    │
│            │                                                        │
│    ┌───────┼───────┬──────────┬──────────┐                        │
│    ▼       ▼       ▼          ▼          ▼                        │
│ ┌─────┐ ┌─────┐ ┌─────┐  ┌────────┐ ┌────────┐                  │
│ │Food │ │Job  │ │Store│  │Cross   │ │Fleet   │  22+ Agent        │
│ │Agent│ │Agent│ │Agent│  │Border  │ │Agent   │    Types           │
│ └─────┘ └─────┘ └─────┘  └────────┘ └────────┘                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. المكونات

### 2.1 Intent Parser — محلل النوايا
- يفهم "ابغى كبسة" → food_order intent
- يفهم "وين طلبي" → tracking intent  
- يفهم "افتحلي متجر" → gen_saas intent
- Arabic NLP + dialect detection

### 2.2 Memory Engine — محرك الذاكرة
- Vector store للذاكرة الدلالية
- Conversation history
- User preferences (halal, price range, favorite restaurants)
- Long-term + Short-term memory

### 2.3 Context Builder — بناء السياق
- يبني سياق المحادثة من الرسائل السابقة
- يحدد المستخدم (consumer/merchant/supplier)
- يحدد السوق (KW/JO/SA...)
- يحدد اللغة واللهجة

### 2.4 Agent Router — موجه الوكلاء
- يوجه الطلب للوكيل المناسب
- يدعم multi-agent coordination
- يدعم agent handoff

### 2.5 Swarm Orchestrator — منسق السرب
- يوزع المهام على الوكلاء
- يجمع النتائج
- يحل التعارضات
- يدير agent-to-agent communication

### 2.6 Bubble Generator — مولد الفقاعات
- يولد JSON للفقاعات (GenUI)
- يحدد theme_key + data
- يدعم 35+ نوع فقاعة

### 2.7 Response Synthesizer — مركب الاستجابات
- يركب إجابة نهائية من نتائج الوكلاء
- يولد نص عربي طبيعي
- يضيف فقاعات + اقتراحات

## 3. نظام السرب (Swarm)

```
Coordinator Agent
    ├── B2C Swarm (Food, Fashion, Grocery, Pharmacy...)
    ├── B2B Swarm (Suppliers, Cross-Border, Haggle...)
    ├── Service Swarm (Fleet, Cleaning, Maintenance...)
    ├── SaaS Swarm (Templates, Workflows, Roles...)
    ├── Connect Swarm (POS, API, Webhooks...)
    └── Intelligence Swarm (Analytics, Mentor, Financial...)
```

## 4. الخطة التقنية

### المرحلة 1: Core Engine (5 ملفات)
- types, intent-parser, memory-engine, context-builder, agent-router

### المرحلة 2: Swarm System (3 ملفات)
- swarm-orchestrator, response-synthesizer, bubble-generator

### المرحلة 3: Routers (3 ملفات)
- jasim-core, swarm, conversation

### المرحلة 4: Integration (1 ملف)
- ربط الـ 22 راوتر الموجود بالـ Core
