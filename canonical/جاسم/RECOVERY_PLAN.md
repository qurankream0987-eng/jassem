# JASIM — RECOVERY & REBUILD PLAN
## From D+ Scaffold to Real General Generative Executable Agent

---

## ARCHITECTURAL PRINCIPLES

1. **GENERAL**: No domain-specific hardcoding. All capabilities are generic primitives.
2. **GENERATIVE**: LLM-powered intent, planning, reasoning, and response generation.
3. **EXECUTABLE**: Real tool execution, real capability chains, real feedback loops.
4. **AGENT**: Autonomous decision-making with memory, learning, and recovery.

---

## PHASE E: RECOVERY FROM GIT HISTORY

### Files to Recover/Adapt

| Source | File | Action | Destination |
|--------|------|--------|-------------|
| final-ai-engine | `api/core/llm-router.ts` | KEEP AS IS (already in master) | `api/core/llm-router.ts` |
| final-ai-engine | Streaming implementation | Wire into frontend | `api/routers/jasim.ts` + frontend |
| be-swarm-system | `api/core/swarm-orchestrator.ts` | EXTRACT generic coordination, REMOVE domain agents | `api/core/swarm-orchestrator.ts` |
| v3_genui | `src/core/genui/intent-classifier.ts` | ADAPT to use LLM + keep regex fallback | `api/core/intent-engine.ts` |
| v3_genui | `src/core/genui/bubble-generator.ts` | ADAPT to generate from task state | `api/core/bubble-generator.ts` |
| final-integration | Notification adapters | EXTRACT as generic notification tools | `api/core/tool-adapters/` |
| master git | `api/core/arabic-nlp.ts` | RECOVER if exists | `api/core/arabic-nlp.ts` |
| master git | `api/core/matching-engine.ts` | RECOVER generic matching | `api/core/matching-engine.ts` |
| master git | `api/core/escrow.ts` | RECOVER if useful | `api/core/escrow.ts` |

---

## PHASE F: CORE RUNTIME REBUILD

### F1: Replace Echo Handlers with Execution Strategies

Each DNA primitive gets an `executionStrategy`:

```typescript
type ExecutionStrategy = 
  | { type: 'llm'; promptTemplate: string; systemPrompt?: string }
  | { type: 'tool'; toolId: string }
  | { type: 'runtime'; handler: Function }
  | { type: 'composite'; steps: ExecutionStrategy[] }
  | { type: 'human_gate'; question: string }
```

**Intelligence Primitives** (LLM-powered):
- UNDERSTAND → LLM semantic understanding
- INTERPRET → LLM context interpretation
- CLASSIFY → LLM classification
- EXTRACT → LLM entity extraction
- REASON → LLM reasoning chain
- PLAN → LLM plan generation
- DECOMPOSE → LLM goal decomposition
- ANALYZE → LLM analysis
- GENERATE → LLM content generation
- CREATE → LLM creation
- TRANSFORM → LLM transformation
- COMMUNICATE → LLM response generation
- ASK → LLM question generation
- NEGOTIATE → LLM negotiation
- ADAPT → LLM adaptation
- LEARN → Runtime pattern recording
- VERIFY → LLM verification
- VALIDATE → LLM validation

**Tool Primitives** (Tool-powered):
- SEARCH → Search tool adapter
- RETRIEVE → Data retrieval tool
- CALCULATE → Calculator tool
- READ → File/data read tool
- WRITE → File/data write tool (with approval)
- VISION → Vision/LLM vision tool
- BOOK → Booking API adapter
- BUY → Purchase API adapter (with approval)
- SELL → Listing API adapter
- LIST → Catalog tool
- TRACK → Tracking API adapter
- MONITOR → Monitoring tool
- SCHEDULE → Calendar/scheduler tool
- FILTER → Data filter tool
- RANK → Ranking algorithm
- MATCH → Matching engine
- EXECUTE → Code execution sandbox

**Runtime Primitives** (Runtime logic):
- DELEGATE → Sub-task delegation
- WAIT → Wait for external event
- RETRY → Retry with backoff
- RECOVER → Error recovery selection
- PERSIST → Persist to database
- REMEMBER → Store to memory
- FORGET → Remove from memory
- CONFIRM → Human confirmation gate

### F2: Real Capability Registry

Replace `echoHandler` with strategy-based dispatch:
```typescript
async execute(capabilityId, inputs, context) {
  const capability = await this.get(capabilityId);
  const strategy = capability.executionStrategy;
  
  switch (strategy.type) {
    case 'llm': return this.executeLLM(capability, inputs, context);
    case 'tool': return this.executeTool(capability, inputs, context);
    case 'runtime': return strategy.handler(inputs, context);
    case 'composite': return this.executeComposite(strategy.steps, inputs, context);
    case 'human_gate': return this.executeHumanGate(capability, inputs, context);
  }
}
```

---

## PHASE G: LLM IN THE GOLDEN PATH

### G1: Intent Engine (Hybrid)
```
User Input
  → Regex Fast Path (if confidence > 0.9)
  → LLM Semantic Understanding (if novel/ambiguous)
  → Entity Extraction (LLM)
  → Constraint Extraction (LLM)
  → Goal Extraction (LLM)
  → Ambiguity Detection (LLM)
  → Confidence Scoring
  → Return Intent
```

### G2: Planner (LLM-powered)
```
Goal + Intent + Available Capabilities
  → LLM generates dynamic plan
  → Plan parsed into DAG
  → Dependencies resolved
  → Risk assessed
  → Human gates identified
  → Fallbacks defined
  → Return Plan
```

### G3: Response Generation (LLM-powered)
```
Task State + Execution Results + User Context
  → LLM generates contextual response
  → Streaming to frontend
  → Dynamic BubbleSchema generation
  → Return Message + Bubble
```

---

## PHASE H: TOOL RUNTIME REAL IMPLEMENTATION

### Real Tools:
1. **LLM Tool** → Calls llm-router with structured prompts
2. **Search Tool** → HTTP API calls (configurable endpoints)
3. **Calculator Tool** → Math.js or similar
4. **File Tool** → File upload/download/processing
5. **Vision Tool** → Image analysis via LLM vision
6. **Database Tool** → Generic DB queries
7. **Memory Tool** → Memory engine operations
8. **Notification Tool** → Email/SMS/WhatsApp adapters
9. **HTTP Tool** → Generic HTTP/API calls
10. **Code Tool** → Code execution sandbox

---

## PHASE I: FRONTEND ↔ BACKEND CONNECTION

### Replace useJasimChat.ts:
```typescript
// BEFORE: Mocked
const { mutate: sendMessage } = api.jasim.sendMessage.useMutation();

// Real implementation:
const sendMessage = async (content: string) => {
  const result = await sendMessageMutation({ conversationId, content });
  // Handle streaming response
  // Update messages
  // Spawn bubbles from result.bubble
};
```

### Streaming:
- tRPC subscription for real-time updates
- SSE for streaming tokens
- WebSocket for bidirectional communication

---

## PHASE K: DYNAMIC BUBBLES

### Backend generates BubbleSchema from task state:
```typescript
function generateBubbleSchema(task: Task): BubbleSchema {
  const currentStep = task.steps.find(s => s.id === task.currentStepId);
  const stepType = currentStep?.type;
  
  switch (stepType) {
    case 'ASK': return generateFormBubble(task);
    case 'CONFIRM': return generateConfirmationBubble(task);
    case 'SEARCH': return generateResultsBubble(task);
    case 'COMPARE': return generateComparisonBubble(task);
    case 'SELECT': return generateSelectionBubble(task);
    default: return generateProgressBubble(task);
  }
}
```

---

## PHASE L: ACTION FEEDBACK LOOP

```
User clicks action in Bubble
  → Frontend sends action to tRPC
  → TaskRuntime.receiveAction(taskId, action)
  → Updates step state
  → Resumes execution
  → Generates new result
  → Updates bubble
  → Updates chat
```

---

## IMPLEMENTATION WAVES

### WAVE 1 (Parallel):
- Agent: core_intelligence_rebuilder (IntentEngine + Planner + LLM wiring)
- Agent: capability_execution_rebuilder (Replace echo handlers)
- Agent: frontend_connector (Wire frontend to backend)

### WAVE 2 (Parallel, depends on WAVE 1):
- Agent: tool_runtime_builder (Real tool implementations)
- Agent: bubble_system_rebuilder (Dynamic bubble generation)
- Agent: action_loop_builder (Feedback loop)

### WAVE 3 (Parallel, depends on WAVE 1-2):
- Agent: memory_learning_builder (Memory influence + learning)
- Agent: security_hardening (Permission enforcement)
- Agent: streaming_implementation (Real streaming)

### WAVE 4 (Sequential):
- Agent: integration_tester (Wire all, test, fix)
- Agent: domain_code_remover (Clean up old routers)
- Agent: build_deploy (Build, test, deploy)

---

## SUCCESS CRITERIA

- [ ] Frontend calls backend API (not mocked)
- [ ] LLM is called in intent understanding
- [ ] LLM is called in planning
- [ ] Capabilities execute real logic (not echo)
- [ ] Tools execute real operations
- [ ] Bubbles are generated from task state
- [ ] Actions flow back to runtime
- [ ] Memory affects execution
- [ ] Recovery works end-to-end
- [ ] Security gates enforced
- [ ] Novel tasks handled without hardcoding
- [ ] Build passes
- [ ] E2E tests pass
