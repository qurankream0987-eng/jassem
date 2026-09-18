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
  /**
   * A failed turn's notice.
   *
   * Deliberately NOT stored in `messages`. That array is the client's copy of
   * canonical conversation state, refilled wholesale from
   * `runtime.conversationsGet`; anything pushed into it is either overwritten
   * by the next refetch or — worse — starts to look like a canonical message
   * that the server never wrote. The notice is a client-side rendering of a
   * failure, so it lives beside the canonical list and is merged only at the
   * point of return.
   */
  const [turnFailure, setTurnFailure] = useState<Message | null>(null);
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
    // No title. The runtime derives one from the first user message, so a
    // client-side placeholder would be indistinguishable from a real name and
    // would block that derivation forever.
    const created = await createConversationMutation.mutateAsync({});
    const conversation = normalizeConversation(created);
    setCurrentConversation(conversation);
    setActiveConversationId(conversation.id);
    setMessages([]);
    setBubbles([]);
    await utils.runtime.conversationsList.invalidate();
    return conversation.id;
  }, [createConversationMutation, utils]);

  const loadConversation = useCallback(async (id: string): Promise<void> => {
    // The notice describes a failed turn in one conversation, not a property of
    // the app; it must not follow the user into another conversation.
    setTurnFailure(null);
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

  const clearMessages = useCallback(() => {
    setMessages([]);
    setTurnFailure(null);
  }, []);

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
    // A new attempt supersedes the previous failure notice.
    setTurnFailure(null);
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

      /*
       * USER_MESSAGE_ACCEPTED != MODEL_RESPONSE_SUCCEEDED.
       *
       * The server writes the user's message to `messages` before it calls the
       * model, in its own committed statement with no transaction spanning the
       * model call — so a provider failure never removes it. Canonical truth
       * was already correct; the client simply never showed it, because
       * `setMessages` ran only in the success branch. A person watched their
       * sentence vanish and an error appear in its place.
       *
       * The repair refetches the canonical conversation rather than
       * re-inserting the message locally. The row exists on the server with its
       * real identity; minting a client-side copy would invent an id, risk a
       * duplicate on retry, and put a message in the list that the server never
       * confirmed. Refetching is both smaller and the only version that cannot
       * create client-side canonical truth.
       */
      try {
        await Promise.all([
          utils.runtime.conversationsGet.invalidate({ conversationId }),
          // The runtime names a conversation from its first user message
          // BEFORE it calls the model, so a failed turn still produced a
          // title. Without this the sidebar keeps showing the placeholder
          // until a reload — and with no model configured, every turn takes
          // this path, so it would be the only thing anyone ever saw.
          utils.runtime.conversationsList.invalidate(),
        ]);
      } catch {
        // If the refetch itself fails the notice is still shown; the canonical
        // message is on the server either way and appears on the next load.
      }
      setTurnFailure({
        id: `runtime-error-${crypto.randomUUID()}`,
        conversationId,
        role: MESSAGE_ROLES.SYSTEM,
        content: detail,
        createdAt: new Date().toISOString(),
      });
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
    /*
     * Canonical messages, plus the transient failure notice when there is one.
     * Merged here rather than stored together, so a refetch can replace the
     * canonical half without dropping the notice, and the notice can never be
     * mistaken for a message the server wrote.
     */
    messages: turnFailure ? [...messages, turnFailure] : messages,
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