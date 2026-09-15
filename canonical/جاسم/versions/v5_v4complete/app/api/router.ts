import { router } from "./trpc";
import { agentsRouter } from "./routers/agents";
import { recruitmentRouter } from "./routers/recruitment";
import { merchantsRouter } from "./routers/merchants";
import { productsRouter } from "./routers/products";
import { ordersRouter } from "./routers/orders";
import { cartRouter } from "./routers/cart";
import { paymentsRouter } from "./routers/payments";
import { suppliersRouter } from "./routers/suppliers";
import { crossborderRouter } from "./routers/crossborder";
import { haggleRouter } from "./routers/haggle";
import { islamicRouter } from "./routers/islamic";
import { fleetRouter } from "./routers/fleet";
import { zakatRouter } from "./routers/zakat";
import { biometricRouter } from "./routers/biometric";
import { visionRouter } from "./routers/vision";
import { voiceRouter } from "./routers/voice";
import { smartConnectRouter } from "./routers/smartconnect";
import { webhooksRouter } from "./routers/webhooks";
import { genSaasRouter } from "./routers/gensaas";
import { genAggregatorRouter } from "./routers/genaggregator";
import { widgetRouter } from "./routers/widget";
import { a2aRouter } from "./routers/a2a";
import { jasimRouter } from "./routers/jasim";
import { conversationRouter } from "./routers/conversation";
import { swarmRouter } from "./routers/swarm";
import { notificationsRouter } from "./routers/notifications";

export const appRouter = router({
  jasim: jasimRouter,
  conversation: conversationRouter,
  swarm: swarmRouter,
  notifications: notificationsRouter,
  agents: agentsRouter,
  recruitment: recruitmentRouter,
  merchants: merchantsRouter,
  products: productsRouter,
  orders: ordersRouter,
  cart: cartRouter,
  payments: paymentsRouter,
  suppliers: suppliersRouter,
  crossborder: crossborderRouter,
  haggle: haggleRouter,
  islamic: islamicRouter,
  fleet: fleetRouter,
  zakat: zakatRouter,
  biometric: biometricRouter,
  vision: visionRouter,
  voice: voiceRouter,
  smartconnect: smartConnectRouter,
  webhooks: webhooksRouter,
  gensaas: genSaasRouter,
  genaggregator: genAggregatorRouter,
  widget: widgetRouter,
  a2a: a2aRouter,
});

export type AppRouter = typeof appRouter;
