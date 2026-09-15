import { Router, type IRouter, type Request, type Response } from "express";
import {
  ActOnRuntimeTaskBody,
  ActOnRuntimeTaskParams,
  ActOnRuntimeTaskResponse,
  CreateRuntimeBubbleBody,
  CreateRuntimeBubbleParams,
  CreateRuntimeBubbleResponse,
  CreateRuntimeConversationBody,
  CreateRuntimeConversationResponse,
  CreateRuntimeMessageBody,
  CreateRuntimeMessageParams,
  CreateRuntimeMessageResponse,
  CreateRuntimeSessionResponse,
  CreateRuntimeTaskBody,
  CreateRuntimeTaskResponse,
  CreateRuntimeRunBody,
  CreateRuntimeRunResponse,
  DecideRuntimeExecutionProposalApprovalBody,
  DecideRuntimeExecutionProposalApprovalParams,
  DecideRuntimeExecutionProposalApprovalResponse,
  GetRuntimeExecutionProposalParams,
  GetRuntimeExecutionProposalResponse,
  GetRuntimeRunParams,
  GetRuntimeRunResponse,
  GetRuntimeBubbleParams,
  GetRuntimeBubbleResponse,
  GetRuntimeConversationParams,
  GetRuntimeConversationResponse,
  GetRuntimeOverviewResponse,
  GetRuntimeTaskParams,
  GetRuntimeTaskResponse,
  GetRuntimeWorldParams,
  GetRuntimeWorldResponse,
  RouteRuntimeConversationTurnBody,
  RouteRuntimeConversationTurnParams,
  RouteRuntimeConversationTurnResponse,
  UpdateRuntimeWorldBody,
  UpdateRuntimeWorldParams,
  UpdateRuntimeWorldResponse,
  ListRuntimeConversationsResponse,
  ListRuntimeRunsResponse,
} from "@workspace/api-zod";
import {
  actOnRuntimeTask,
  createRuntimeTask,
  createRuntimeRun,
  createRuntimeBubble,
  createRuntimeConversation,
  decideExecutionProposalApproval,
  createRuntimeMessage,
  evolveRuntimeWorld,
  getRuntimeBubble,
  getRuntimeConversation,
  getExecutionProposal,
  getRuntimeOverview,
  getRuntimeTask,
  getRuntimeRun,
  getRuntimeWorld,
  issueRuntimeSession,
  listRuntimeConversations,
  listRuntimeRuns,
  resolveRuntimeActor,
  routeRuntimeConversationTurn,
  RuntimeAccessError,
  RuntimeActionError,
  RuntimeSessionError,
  ModelGatewayOutputError,
  ModelGatewayUnavailableError,
} from "../lib/jasim-runtime";

const router: IRouter = Router();
const generationRequestsByIp = new Map<string, number[]>();
const generationRequests = [] as number[];
const generationWindowMs = 60 * 60 * 1000;
const maxTrackedSources = 2_000;
const configuredGenerationLimit = Number(process.env.JASIM_MODEL_REQUEST_LIMIT ?? 10);
const generationLimit =
  Number.isSafeInteger(configuredGenerationLimit) && configuredGenerationLimit > 0
    ? configuredGenerationLimit
    : 10;
const configuredServiceGenerationLimit = Number(
  process.env.JASIM_MODEL_SERVICE_REQUEST_LIMIT ?? 100,
);
const serviceGenerationLimit =
  Number.isSafeInteger(configuredServiceGenerationLimit) &&
  configuredServiceGenerationLimit > 0
    ? configuredServiceGenerationLimit
    : 100;

function requestError(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function canGenerateForIp(ip: string): boolean {
  const now = Date.now();
  for (const [candidateIp, timestamps] of generationRequestsByIp) {
    if (timestamps.every((requestedAt) => now - requestedAt >= generationWindowMs)) {
      generationRequestsByIp.delete(candidateIp);
    }
  }
  const requests = (generationRequestsByIp.get(ip) ?? []).filter(
    (requestedAt) => now - requestedAt < generationWindowMs,
  );
  const activeServiceRequests = generationRequests.filter(
    (requestedAt) => now - requestedAt < generationWindowMs,
  );
  if (
    requests.length >= generationLimit ||
    activeServiceRequests.length >= serviceGenerationLimit
  ) {
    if (generationRequestsByIp.has(ip)) generationRequestsByIp.set(ip, requests);
    return false;
  }
  if (!generationRequestsByIp.has(ip) && generationRequestsByIp.size >= maxTrackedSources) {
    return false;
  }
  requests.push(now);
  generationRequestsByIp.set(ip, requests);
  generationRequests.splice(0, generationRequests.length, ...activeServiceRequests, now);
  return true;
}

function resolveActor(req: Request, res: Response): string | null {
  try {
    return resolveRuntimeActor(req, res);
  } catch (error) {
    if (error instanceof RuntimeSessionError) {
      res.status(401).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

router.post("/runtime/session", async (req, res): Promise<void> => {
  if (!resolveActor(req, res)) return;
  res.json(CreateRuntimeSessionResponse.parse(issueRuntimeSession(req, res)));
});

router.get("/runtime/conversations", async (req, res): Promise<void> => {
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  res.json(ListRuntimeConversationsResponse.parse(await listRuntimeConversations(ownerId)));
});

router.post("/runtime/conversations", async (req, res): Promise<void> => {
  const parsed = CreateRuntimeConversationBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    requestError(res, parsed.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  const response = await createRuntimeConversation({ ownerId, ...parsed.data });
  res.status(201).json(CreateRuntimeConversationResponse.parse(response));
});

router.get("/runtime/conversations/:conversationId", async (req, res): Promise<void> => {
  const params = GetRuntimeConversationParams.safeParse(req.params);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.json(
      GetRuntimeConversationResponse.parse(
        await getRuntimeConversation(params.data.conversationId, ownerId),
      ),
    );
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

router.post("/runtime/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const params = CreateRuntimeMessageParams.safeParse(req.params);
  const body = CreateRuntimeMessageBody.safeParse(req.body);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.status(201).json(
      CreateRuntimeMessageResponse.parse(
        await createRuntimeMessage({
          ownerId,
          conversationId: params.data.conversationId,
          ...body.data,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

router.post("/runtime/conversations/:conversationId/turns", async (req, res): Promise<void> => {
  const params = RouteRuntimeConversationTurnParams.safeParse(req.params);
  const body = RouteRuntimeConversationTurnBody.safeParse(req.body);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  if (!canGenerateForIp(req.ip ?? "unknown")) {
    res.status(429).json({
      error: `Too many generation requests. Try again after ${Math.ceil(generationWindowMs / 60_000)} minutes.`,
    });
    return;
  }
  try {
    const response = await routeRuntimeConversationTurn({
      ownerId,
      conversationId: params.data.conversationId,
      content: body.data.content,
    });
    res.status(201).json(RouteRuntimeConversationTurnResponse.parse(response));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof ModelGatewayUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof ModelGatewayOutputError) {
      res.status(502).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/runtime/conversations/:conversationId/bubbles", async (req, res): Promise<void> => {
  const params = CreateRuntimeBubbleParams.safeParse(req.params);
  const body = CreateRuntimeBubbleBody.safeParse(req.body);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.status(201).json(
      CreateRuntimeBubbleResponse.parse(
        await createRuntimeBubble({
          ownerId,
          conversationId: params.data.conversationId,
          ...body.data,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/runtime/bubbles/:bubbleId", async (req, res): Promise<void> => {
  const params = GetRuntimeBubbleParams.safeParse(req.params);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.json(GetRuntimeBubbleResponse.parse(await getRuntimeBubble(params.data.bubbleId, ownerId)));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/runtime/overview", async (req, res): Promise<void> => {
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  const response = await getRuntimeOverview(ownerId);
  res.json(GetRuntimeOverviewResponse.parse(response));
});

router.post("/runtime/tasks", async (req, res): Promise<void> => {
  const parsed = CreateRuntimeTaskBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid runtime task request");
    requestError(res, parsed.error.message);
    return;
  }

  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  if (!canGenerateForIp(req.ip ?? "unknown")) {
    res.status(429).json({
      error: `Too many planning requests. Try again after ${Math.ceil(generationWindowMs / 60_000)} minutes.`,
    });
    return;
  }
  try {
    const response = await createRuntimeTask({
      ...parsed.data,
      ownerId,
    });
    res.status(201).json(CreateRuntimeTaskResponse.parse(response));
  } catch (error) {
    if (error instanceof ModelGatewayUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof ModelGatewayOutputError) {
      res.status(502).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/runtime/runs", async (req, res): Promise<void> => {
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  res.json(ListRuntimeRunsResponse.parse(await listRuntimeRuns(ownerId)));
});

router.post("/runtime/runs", async (req, res): Promise<void> => {
  const body = CreateRuntimeRunBody.safeParse(req.body);
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    const response = await createRuntimeRun({ ...body.data, ownerId });
    res.status(201).json(CreateRuntimeRunResponse.parse(response));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

router.get("/runtime/runs/:runId", async (req, res): Promise<void> => {
  const params = GetRuntimeRunParams.safeParse(req.params);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.json(GetRuntimeRunResponse.parse(await getRuntimeRun(params.data.runId, ownerId)));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/runtime/proposals/:proposalId", async (req, res): Promise<void> => {
  const params = GetRuntimeExecutionProposalParams.safeParse(req.params);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.json(
      GetRuntimeExecutionProposalResponse.parse(
        await getExecutionProposal(params.data.proposalId, ownerId),
      ),
    );
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

router.post("/runtime/proposals/:proposalId/approval", async (req, res): Promise<void> => {
  const params = DecideRuntimeExecutionProposalApprovalParams.safeParse(req.params);
  const body = DecideRuntimeExecutionProposalApprovalBody.safeParse(req.body);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    res.json(
      DecideRuntimeExecutionProposalApprovalResponse.parse(
        await decideExecutionProposalApproval({
          ownerId,
          proposalId: params.data.proposalId,
          decision: body.data.decision,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

router.get("/runtime/tasks/:taskId", async (req, res): Promise<void> => {
  const params = GetRuntimeTaskParams.safeParse(req.params);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }

  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    const response = await getRuntimeTask(params.data.taskId, ownerId);
    res.json(GetRuntimeTaskResponse.parse(response));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/runtime/tasks/:taskId/actions", async (req, res): Promise<void> => {
  const params = ActOnRuntimeTaskParams.safeParse(req.params);
  const body = ActOnRuntimeTaskBody.safeParse(req.body);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }

  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    const response = await actOnRuntimeTask({
      taskId: params.data.taskId,
      actionId: body.data.actionId,
      idempotencyKey: body.data.idempotencyKey,
      actionInput: body.data.input,
      approval: body.data.approval,
      ownerId,
    });
    res.json(ActOnRuntimeTaskResponse.parse(response));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

router.get("/runtime/worlds/:worldId", async (req, res): Promise<void> => {
  const params = GetRuntimeWorldParams.safeParse(req.params);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    const response = await getRuntimeWorld(params.data.worldId, ownerId);
    res.json(GetRuntimeWorldResponse.parse(response));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/runtime/worlds/:worldId/changes", async (req, res): Promise<void> => {
  const params = UpdateRuntimeWorldParams.safeParse(req.params);
  const body = UpdateRuntimeWorldBody.safeParse(req.body);
  if (!params.success) {
    requestError(res, params.error.message);
    return;
  }
  if (!body.success) {
    requestError(res, body.error.message);
    return;
  }
  const ownerId = resolveActor(req, res);
  if (!ownerId) return;
  try {
    const response = await evolveRuntimeWorld({
      worldId: params.data.worldId,
      ownerId,
      baseVersion: body.data.baseVersion,
      summary: body.data.summary,
      changes: body.data.changes,
    });
    res.json(UpdateRuntimeWorldResponse.parse(response));
  } catch (error) {
    if (error instanceof RuntimeAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof RuntimeActionError) {
      requestError(res, error.message);
      return;
    }
    throw error;
  }
});

export default router;
