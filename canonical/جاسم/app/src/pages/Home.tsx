import { useState, useCallback, useEffect } from 'react';
import { JasimChat, ChatSidebar } from '@/components/chat';
import { useJasimChat } from '@/hooks/useJasimChat';
import { RuntimeBubbleLayer } from '@/components/jasim-core/RuntimeBubbleLayer';
import {
  ActiveGenerativeWorkspace,
  type WorkspacePresentationContext,
  type WorkspacePresentationReference,
} from '@/components/jasim-core/ActiveGenerativeWorkspace';
import { ActiveObjectsRail } from '@/components/jasim-core/ActiveObjectsRail';
import { useRuntimeBubbles } from '@/hooks/useRuntimeBubbles';
import type { BubbleSchema } from '@contracts/jasim';
import type { LivingObjectProjection } from '../../api/runtime/presentation-fabric';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { useTrustedActionDispatcher } from '@/hooks/useTrustedActionDispatcher';
import {
  createTrustedActionEnvelope,
  trustedActionFailure,
} from '@/lib/trusted-action-dispatcher';

// ── Main Home Page ───────────────────────────────────────────────────────────

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const utils = trpc.useUtils();
  const { dispatch } = useTrustedActionDispatcher();
  const handleTurnComplete = useCallback(
    async (conversationId: string) => {
      await utils.runtime.workspaceProjection.invalidate({ conversationId });
      await utils.runtime.activeLivingObjects.invalidate();
    },
    [utils],
  );
  const {
    bubbles: runtimeBubbles,
    refresh: refreshRuntimeBubbles,
    transition: transitionRuntimeBubble,
  } = useRuntimeBubbles();

  // Check mobile on mount
  useState(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  });

  const {
    messages,
    isLoading,
    isStreaming,
    conversations,
    currentConversation,
    bubbles: backendBubbles,
    sendMessage,
    createConversation,
    loadConversation,
    deleteConversation,
    clearMessages,
  } = useJasimChat({
    onBubbleSpawn: () => {
      void refreshRuntimeBubbles();
      void utils.runtime.activeLivingObjects.invalidate();
    },
    onTurnComplete: handleTurnComplete,
  });

  // A turn can create a Bubble; the canonical list remains the display source.
  useEffect(() => {
    if (backendBubbles.length > 0) void refreshRuntimeBubbles();
  }, [backendBubbles.length, refreshRuntimeBubbles]);

  const handleBubbleClick = useCallback(
    async (bubble: BubbleSchema) => {
      const bubbleId = String(bubble.metadata?.runtimeBubbleId ?? bubble.id);
      const runtimeBubble = runtimeBubbles.find((item) => item.bubbleId === bubbleId);
      if (!runtimeBubble) {
        await refreshRuntimeBubbles();
        toast.info('يتم تحديث سطح جاسم من الحالة المحفوظة.');
        return;
      }
      await transitionRuntimeBubble(bubbleId, 'expand');
    },
    [refreshRuntimeBubbles, runtimeBubbles, transitionRuntimeBubble],
  );

  const handleActionClick = useCallback(
    (actionId: string, bubbleData?: BubbleSchema) => {
      if (bubbleData) {
        void handleBubbleClick(bubbleData);
        const bubbleId = String(bubbleData.metadata?.runtimeBubbleId ?? bubbleData.id);
        const runtimeBubble = runtimeBubbles.find((item) => item.bubbleId === bubbleId);
        if (runtimeBubble) {
          void dispatch(
            createTrustedActionEnvelope({
              actionId: `conversation-action:${bubbleId}:${actionId}:${runtimeBubble.presentation.presentationVersion}`,
              actionType: 'REQUEST_CHANGE',
              intent: actionId,
              source: 'CONVERSATION',
              targetReference: { kind: 'smart_bubble', id: bubbleId },
              presentationReference: { kind: 'bubble', id: bubbleId },
              expectedPresentationVersion: `presentation:${runtimeBubble.presentation.presentationVersion}`,
              idempotencyKey: `conversation-action:${bubbleId}:${actionId}`,
              payload: { instruction: actionId },
            }),
          ).then((result) => {
            const failure = trustedActionFailure(result);
            if (failure) toast.info(failure.message);
          }).catch((error) => {
            toast.error(error instanceof Error ? error.message : 'تعذر إرسال الإجراء.');
          });
          return;
        }
      }
      toast.info(`الإجراء ${actionId} لا يملك سطحًا موثوقًا متاحًا الآن.`);
    },
    [dispatch, handleBubbleClick, runtimeBubbles],
  );

  const dispatchWorkspaceAction = useCallback(
    async (intent: string, context: WorkspacePresentationContext) => {
      const normalizedIntent = intent.trim().toLowerCase();
      let actionType:
        | 'OPEN_REFERENCE'
        | 'SUBMIT_INPUT'
        | 'SELECT_ENTITY'
        | 'APPROVE_PROPOSAL'
        | 'RESUME_OPERATION'
        | 'REQUEST_EXECUTION'
        | 'CANCEL_OPERATION'
        | null = null;
      let targetReference: WorkspacePresentationReference | undefined;
      let payload: Record<string, unknown> = {};

      if (normalizedIntent === 'open' || normalizedIntent === 'open_reference') {
        actionType = 'OPEN_REFERENCE';
        targetReference = context.targetReference;
      } else if (normalizedIntent === 'approve' || normalizedIntent === 'reject') {
        actionType = 'APPROVE_PROPOSAL';
        targetReference = context.approvalReference;
        payload = { decision: normalizedIntent };
      } else if (normalizedIntent === 'resume') {
        actionType = 'RESUME_OPERATION';
        targetReference = context.approvalReference;
      } else if (
        normalizedIntent === 'execute' ||
        normalizedIntent === 'run' ||
        normalizedIntent === 'retry'
      ) {
        actionType = 'REQUEST_EXECUTION';
        targetReference = context.targetReference;
      } else if (normalizedIntent === 'cancel') {
        actionType = 'CANCEL_OPERATION';
        targetReference = context.targetReference;
      } else if (normalizedIntent.startsWith('select:')) {
        actionType = 'SELECT_ENTITY';
        targetReference = context.targetReference;
        payload = { entityId: intent.slice('select:'.length).trim() };
      }

      if (!actionType || !targetReference) {
        toast.info('هذا الإجراء ليس له مسار Runtime موثوق بعد.');
        return;
      }
      const expectedPresentationVersion =
        actionType === 'APPROVE_PROPOSAL' || actionType === 'RESUME_OPERATION'
          ? context.approvalExpectedPresentationVersion
          : context.targetExpectedPresentationVersion;
      if (!expectedPresentationVersion) {
        toast.info('لا تتوفر نسخة canonical حالية لهذا الإجراء.');
        return;
      }

      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `workspace:${actionType}:${targetReference.kind}:${targetReference.id}:${expectedPresentationVersion}`,
          actionType,
          intent,
          source: 'WORKSPACE',
          targetReference,
          conversationReference: context.conversationReference,
          goalReference: context.goalReference,
          presentationReference: {
            kind: 'workspace',
            id: context.conversationReference?.id ?? targetReference.id,
          },
          expectedPresentationVersion,
          idempotencyKey: `workspace:${actionType}:${targetReference.id}`,
          payload,
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) {
        toast.error(failure.message);
        return;
      }
      toast.success('تم إرسال الإجراء إلى الحالة الموثوقة.');
    },
    [dispatch],
  );

  const dispatchWorkspaceSubmit = useCallback(
    async (
      data: Record<string, unknown>,
      schema: BubbleSchema,
      context: WorkspacePresentationContext,
    ) => {
      const targetReference = context.goalReference?.kind === 'runtime_task'
        ? context.goalReference
        : context.targetReference?.kind === 'runtime_task'
          ? context.targetReference
          : undefined;
      const actionId = schema.actions?.find((action) => action.type !== 'cancel')?.id;
      if (!targetReference || !actionId) {
        toast.info('لا يوجد إجراء إدخال موثوق لهذا النموذج.');
        return;
      }
      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `workspace-submit:${targetReference.id}:${actionId}:${context.expectedPresentationVersion}`,
          actionType: 'SUBMIT_INPUT',
          intent: 'submit_input',
          source: 'WORKSPACE',
          targetReference,
          conversationReference: context.conversationReference,
          goalReference: context.goalReference,
          presentationReference: {
            kind: 'workspace',
            id: context.conversationReference?.id ?? targetReference.id,
          },
          expectedPresentationVersion:
            context.targetExpectedPresentationVersion ?? context.expectedPresentationVersion,
          idempotencyKey: `workspace-submit:${targetReference.id}:${actionId}`,
          payload: { actionId, input: data },
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) {
        toast.error(failure.message);
        return;
      }
      toast.success('تم استلام البيانات وتحديث الحالة الموثوقة.');
    },
    [dispatch],
  );

  const handleNewConversation = useCallback(async () => {
    await createConversation();
    if (isMobile) setSidebarOpen(false);
  }, [createConversation, isMobile]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      loadConversation(id);
      if (isMobile) setSidebarOpen(false);
    },
    [loadConversation, isMobile]
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      deleteConversation(id);
      toast.success('Conversation deleted');
    },
    [deleteConversation]
  );

  const handleSendMessage = useCallback(
    (content: string, files?: File[]) => {
      sendMessage(content, files);
    },
    [sendMessage]
  );

  const handleLivingObjectOpen = useCallback(async (object: LivingObjectProjection) => {
    const result = await dispatch(
      createTrustedActionEnvelope({
        actionId: `living-open:${object.id}:${object.presentationVersion}`,
        actionType: 'OPEN_REFERENCE',
        intent: 'open',
        source: 'LIVING_OBJECT',
        targetReference: object.underlyingReference,
        presentationReference: { kind: 'living_object', id: object.id },
        expectedPresentationVersion: object.presentationVersion,
        idempotencyKey: `living-open:${object.id}`,
        payload: {},
      }),
    );
    const failure = trustedActionFailure(result);
    if (failure) {
      toast.error(failure.message);
      return;
    }
    const workspace = document.querySelector<HTMLElement>(
      '[data-testid="active-generative-workspace"]',
    );
    if (!workspace) {
      toast.info('Open a conversation to restore this context.');
      return;
    }
    workspace.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    workspace.querySelector<HTMLElement>('h2[tabindex="-1"]')?.focus({ preventScroll: true });
    toast.info(`Focused ${object.title}`);
  }, [dispatch]);

  return (
    <div className="h-screen w-screen bg-slate-950 flex overflow-hidden">
      {/* Sidebar */}
      {(!isMobile || sidebarOpen) && (
        <div className={`${isMobile ? 'absolute inset-y-0 left-0 z-50' : 'relative'}`}>
          <ChatSidebar
            conversations={conversations}
            currentConversationId={currentConversation?.id}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={handleDeleteConversation}
            onNewConversation={handleNewConversation}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen((prev) => !prev)}
          />
          {/* Mobile overlay */}
          {isMobile && sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-[-1]"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <span className="text-sm font-medium text-slate-300 truncate max-w-[200px]">
              {currentConversation?.title || 'New Conversation'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
              >
                Clear
              </button>
            )}
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-slate-500 ml-1">Online</span>
          </div>
        </div>

        {/* Conversation and contextual workspace stay available together. */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 min-w-0 flex-1">
            <JasimChat
              messages={messages}
              isLoading={isLoading}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onBubbleClick={handleBubbleClick}
              onActionClick={handleActionClick}
              placeholder="Ask JASIM anything..."
              showSuggestions={true}
              disabled={false}
            />
          </div>
          <div className="flex min-h-0 w-full shrink-0 flex-col gap-2 lg:w-[min(62vw,47rem)] lg:flex-row">
            <ActiveGenerativeWorkspace
              conversationId={currentConversation?.id}
              onPresentationAction={(intent, context) => {
                void dispatchWorkspaceAction(intent, context);
              }}
              onPresentationSubmit={(data, schema, context) => {
                void dispatchWorkspaceSubmit(data, schema, context);
              }}
              className="order-2 max-h-[42dvh] w-full border-t border-white/10 p-2 lg:order-1 lg:max-h-none lg:min-w-0 lg:flex-1 lg:border-t-0 lg:p-3"
            />
            <ActiveObjectsRail
              onOpen={handleLivingObjectOpen}
              className="order-1 max-h-[18dvh] w-full overflow-hidden lg:order-2 lg:max-h-none lg:w-[min(22vw,16rem)]"
            />
          </div>
        </div>
      </div>

      <RuntimeBubbleLayer
        bubbles={runtimeBubbles}
        onPresentationAction={(bubbleId, action) => {
          void transitionRuntimeBubble(bubbleId, action).catch((error) => {
            toast.error(error instanceof Error ? error.message : 'تعذر تحديث حالة الفقاعة.');
          });
        }}
      />
    </div>
  );
}
