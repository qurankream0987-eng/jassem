import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import type { BubbleSchema, Conversation, Message } from "@contracts/jasim";
import { userFacingRuntimeError } from "@/lib/runtime-error-copy";
import { MESSAGE_ROLES } from "@contracts/constants";

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  data?: string;
}

export interface UseJasimChatOptions {
  conversationId?: string;
  onBubbleSpawn?: (bubble: BubbleSchema) => void;
  onTurnComplete?: (conversationId: string) => void | Promise<void>;
}

/** A lightweight record of an active durable run surfaced from a turn output. */
export interface ActiveRun {
  runId: string;
  proposalIds: string[];
  label?: string;
  /** The message id that spawned this run (used to associate card with message) */
  messageId: string;
}

export interface UseJasimChatReturn {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  currentConversation: Conversation | null;
  conversations: Conversation[];
  attachments: ChatAttachment[];
  bubbles: BubbleSchema[];
  /** Active durable runs spawned by the current conversation, newest first. */
  activeRuns: ActiveRun[];
  sendMessage: (content: string, files?: File[]) => Promise<void>;
  createConversation: () => Promise<string>;
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  clearMessages: () => void;
  addAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  searchConversations: (query: string) => Conversation[];
  closeBubble: (id: string) => void;
  updateBubbleData: (id: string, data: Record<string, unknown>) => void;
}

type RuntimeRecord = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function normalizeConversation(raw: unknown): Conversation {
  const conversation = raw as RuntimeRecord;
  return {
    id: String(conversation.id),
    userId: "runtime-owner",
    title: typeof conversation.title === "string" ? conversation.title : undefined,
    status: conversation.status === "archived" || conversation.status === "closed" ? conversation.status : "active",
    context: {},
    createdAt: iso(conversation.createdAt),
    updatedAt: iso(conversation.updatedAt),
  };
}

function runtimeBubbleToSchema(raw: unknown): BubbleSchema {
  const bubble = raw as RuntimeRecord;
  const presentationState =
    bubble.presentationState && typeof bubble.presentationState === "object"
      ? (bubble.presentationState as Record<string, unknown>)
      : {};

  return {
    id: String(bubble.id),
    type: "card",
    title: String(bubble.title ?? "JASIM Bubble"),
    subtitle: String(bubble.semanticDescription ?? ""),
    layout: {
      width: "auto",
      height: "auto",
      rtl: /[\u0591-\u07FF]/.test(`${bubble.title ?? ""} ${bubble.semanticDescription ?? ""}`),
    },
    theme: { dark: true, glassmorphism: true },
    data: presentationState,
    actions: [],
    trust: { level: "system", verified: true, badges: ["runtime"] },
    version: "1",
    metadata: {
      runtimeBubbleId: String(bubble.id),
      runtimeWorldId: bubble.runtimeWorldId ?? null,
      mode: bubble.mode,
      activeView: bubble.activeView,
      references: bubble.references ?? [],
    },
  };
}

function normalizeMessage(raw: unknown, conversationId: string): Message {
  const message = raw as RuntimeRecord;
  return {
    id: String(message.id),
    conversationId,
    role: (message.role as Message["role"]) || MESSAGE_ROLES.ASSISTANT,
    content: String(message.content ?? ""),
    bubbleData: message.bubbleData as BubbleSchema | undefined,
    metadata: (message.metadata as Record<string, unknown> | undefined) ?? {},
    createdAt: iso(message.createdAt),
  };
}

export function useJasimChat(options: UseJasimChatOptions = {}): UseJasimChatReturn {
  const { conversationId: initialConversationId, onBubbleSpawn, onTurnComplete } = options;
  const utils = trpc.useUtils();
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    initialConversationId,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [bubbles, setBubbles] = useState<BubbleSchema[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const listQuery = trpc.runtime.conversationsList.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const conversationQuery = trpc.runtime.conversationsGet.useQuery(
    { conversationId: activeConversationId ?? "" },
    { enabled: Boolean(activeConversationId), refetchOnWindowFocus: false, retry: 1 },
  );
  const createConversationMutation = trpc.runtime.conversationsCreate.useMutation();
  const archiveConversationMutation = trpc.runtime.conversationsArchive.useMutation();
  const createTurnMutation = trpc.runtime.turnsCreate.useMutation();

  const conversations = (listQuery.data?.conversations ?? []).map(normalizeConversation);

  useEffect(() => {
    if (initialConversationId) setActiveConversationId(initialConversationId);
  }, [initialConversationId]);

  useEffect(() => {
    if (!conversationQuery.data || !activeConversationId) return;
    const runtimeConversation = conversationQuery.data as RuntimeRecord;
    const normalizedConversation = normalizeConversation(runtimeConversation);
    setCurrentConversation(normalizedConversation);
    setMessages(
      Array.isArray(runtimeConversation.messages)
        ? runtimeConversation.messages.map((message) =>
            normalizeMessage(message, normalizedConversation.id),
          )
        : [],
    );
    setBubbles(
      Array.isArray(runtimeConversation.bubbles)
        ? runtimeConversation.bubbles.map(runtimeBubbleToSchema)
        : [],
    );
  }, [activeConversationId, conversationQuery.data]);

  const createConversation = useCallback(async (): Promise<string> => {
    const created = await createConversationMutation.mutateAsync({ title: "محادثة جديدة" });
    const conversation = normalizeConversation(created);
    setCurrentConversation(conversation);
    setActiveConversationId(conversation.id);
    setMessages([]);
    setBubbles([]);
    await utils.runtime.conversationsList.invalidate();
    return conversation.id;
  }, [createConversationMutation, utils]);

  const loadConversation = useCallback(async (id: string): Promise<void> => {
    setActiveConversationId(id);
  }, []);

  const deleteConversation = useCallback(async (id: string): Promise<void> => {
    await archiveConversationMutation.mutateAsync({ conversationId: id });
    if (currentConversation?.id === id) {
      setCurrentConversation(null);
      setActiveConversationId(undefined);
      setMessages([]);
      setBubbles([]);
    }
    await utils.runtime.conversationsList.invalidate();
  }, [archiveConversationMutation, currentConversation?.id, utils]);

  const clearMessages = useCallback(() => setMessages([]), []);

  const addAttachment = useCallback((file: File) => {
    setAttachments((current) => [
      ...current,
      {
        id: `attachment-${crypto.randomUUID()}`,
        name: file.name,
        type: file.type,
        size: file.size,
      },
    ]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const searchConversations = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((conversation) =>
      conversation.title?.toLowerCase().includes(normalized),
    );
  }, [conversations]);

  const closeBubble = useCallback((id: string) => {
    setBubbles((current) => current.filter((bubble) => bubble.id !== id));
  }, []);

  const updateBubbleData = useCallback((id: string, data: Record<string, unknown>) => {
    setBubbles((current) =>
      current.map((bubble) =>
        bubble.id === id ? { ...bubble, data: { ...bubble.data, ...data } } : bubble,
      ),
    );
  }, []);

  const sendMessage = useCallback(async (content: string, files?: File[]): Promise<void> => {
    if (!content.trim() && (!files || files.length === 0)) return;

    let conversationId = currentConversation?.id;
    if (!conversationId) conversationId = await createConversation();

    if (files?.length || attachments.length) {
      setMessages((current) => [
        ...current,
        {
          id: `attachment-not-supported-${crypto.randomUUID()}`,
          conversationId,
          role: MESSAGE_ROLES.SYSTEM,
          content: "File attachments are not enabled in this Runtime yet.",
          createdAt: new Date().toISOString(),
        },
      ]);
      return;
    }

    setIsLoading(true);
    try {
      const result = await createTurnMutation.mutateAsync({ conversationId, content: content.trim() });
      const output = result.output as RuntimeRecord;
      const runtimeBubble = output.bubble ? runtimeBubbleToSchema(output.bubble) : undefined;
      const userMessage = normalizeMessage(result.userMessage, conversationId);
      const assistantMessage = normalizeMessage(
        { ...result.assistantMessage, bubbleData: runtimeBubble },
        conversationId,
      );
      setMessages((current) => [...current, userMessage, assistantMessage]);
      if (runtimeBubble) {
        setBubbles((current) =>
          current.some((bubble) => bubble.id === runtimeBubble.id)
            ? current
            : [...current, runtimeBubble],
        );
        onBubbleSpawn?.(runtimeBubble);
      }
      // Phase I — extract durable_run metadata to surface lifecycle card
      if (output.kind === "durable_run") {
        const meta = (result.assistantMessage as RuntimeRecord).metadata as RuntimeRecord | undefined;
        const runId = String(meta?.runId ?? "");
        const proposalIds = Array.isArray(meta?.proposalIds)
          ? (meta.proposalIds as unknown[]).map(String)
          : [];
        if (runId) {
          const activeRun: ActiveRun = {
            runId,
            proposalIds,
            label: typeof output.label === "string" ? output.label : undefined,
            messageId: String((result.assistantMessage as RuntimeRecord).id),
          };
          setActiveRuns((current) => {
            // deduplicate by runId
            const filtered = current.filter((r) => r.runId !== runId);
            return [activeRun, ...filtered];
          });
        }
      }
      await Promise.all([
        utils.runtime.conversationsList.invalidate(),
        utils.runtime.conversationsGet.invalidate({ conversationId }),
      ]);
      try {
        await onTurnComplete?.(conversationId);
      } catch {
        // A workspace refresh must not turn a completed conversation turn into an error.
      }
    } catch (error) {
      /*
       * A runtime error is not a message to the user in the language the
       * runtime happens to speak.
       *
       * The raw gateway string went straight into the conversation, so a
       * blocked turn read: "No model service is configured. Configure
       * JASIM_MODEL_PROVIDER with its provider API key before creating a
       * task." — English, addressed to an operator, and naming an environment
       * variable to somebody who will never set one.
       *
       * The runtime's own vocabulary is translated where it is recognised; the
       * raw text is kept only as a diagnostic, never as the message.
       */
      const detail = userFacingRuntimeError(error);
      setMessages((current) => [
        ...current,
        {
          id: `runtime-error-${crypto.randomUUID()}`,
          conversationId,
          role: MESSAGE_ROLES.SYSTEM,
          content: detail,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [
    attachments.length,
    createConversation,
    createTurnMutation,
    currentConversation?.id,
    onBubbleSpawn,
    onTurnComplete,
    utils,
  ]);

  return {
    messages,
    isLoading,
    isStreaming: false,
    currentConversation,
    conversations,
    attachments,
    bubbles,
    activeRuns,
    sendMessage,
    createConversation,
    loadConversation,
    deleteConversation,
    clearMessages,
    addAttachment,
    removeAttachment,
    searchConversations,
    closeBubble,
    updateBubbleData,
  };
}