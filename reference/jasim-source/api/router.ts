import { router } from "./trpc";
import { jasimRouter } from "./routers/jasim";
import { streamRouter } from "./routers/stream";
import { conversationRouter } from "./routers/conversation";
import { taskRouter } from "./routers/task";
import { capabilityRouter } from "./routers/capability";
import { entityRouter } from "./routers/entity";
import { approvalRouter } from "./routers/approval";
import { bubbleRouter } from "./routers/bubble";
import { notificationsRouter } from "./routers/notifications";
import { securityRouter } from "./routers/security";
import { dnaRouter } from "./routers/dna";
import { externalActionsRouter } from "./routers/external-actions";
import { worldsRouter } from "./routers/worlds";
import { coreEvolutionRouter } from "./routers/core-evolution";

export const appRouter = router({
  jasim: jasimRouter,
  stream: streamRouter,
  conversation: conversationRouter,
  task: taskRouter,
  capability: capabilityRouter,
  entity: entityRouter,
  approval: approvalRouter,
  bubble: bubbleRouter,
  notifications: notificationsRouter,
  security: securityRouter,
  dna: dnaRouter,
  externalActions: externalActionsRouter,
  worlds: worldsRouter,
  coreEvolution: coreEvolutionRouter,
});

export type AppRouter = typeof appRouter;
