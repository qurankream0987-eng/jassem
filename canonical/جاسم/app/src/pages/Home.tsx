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
  /**
   * The sidebar defaulted to open and `isMobile` to false, and the viewport
   * check ran in an effect — so the first paint on a phone put the conversation
   * list on top of the conversation itself, with the composer and the answer
   * behind it. Both now start from the real viewport, so the phone never paints
   * a covered conversation.
   */
  const initiallyMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const [sidebarOpen, setSidebarOpen] = useState(!initiallyMobile);
  const [isMobile, setIsMobile] = useState(initiallyMobile);
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

  // This was written as `useState(() => { ... })`, which treats the whole body
  // as a lazy initialiser: the listener was never registered and the cleanup
  // function was stored as state. `isMobile` was therefore computed once and
  // never again, so rotating a device or resizing a window left the layout in
  // whatever mode it started in.
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile((was) => {
        // Crossing the breakpoint closes an overlay sidebar rather than leaving
        // it covering the conversation at phone width.
        if (mobile && !was) setSidebarOpen(false);
        if (!mobile && was) setSidebarOpen(true);
        return mobile;
      });
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
      toast.success('تم حذف المحادثة.');
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
      toast.info('افتح محادثة لاستعادة هذا السياق.');
      return;
    }
    workspace.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    workspace.querySelector<HTMLElement>('h2[tabindex="-1"]')?.focus({ preventScroll: true });
    toast.info(`تم التركيز على «${object.title}».`);
  }, [dispatch]);

  return (
    // JASIM is Arabic-first. The document direction belongs at the root, not
    // sprinkled onto individual components — sixteen `dir="rtl"` attributes on
    // leaf nodes left the layout itself (sidebar side, message alignment,
    // scrollbars) running left-to-right underneath them.
    <div dir="rtl" lang="ar" className="flex h-[100dvh] w-full overflow-hidden bg-[var(--jasim-bg)]">
      {/* Sidebar */}
      {(!isMobile || sidebarOpen) && (
        <div className={`h-full ${isMobile ? 'absolute inset-y-0 start-0 z-50' : 'relative'}`}>
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
        <div className="flex items-center justify-between border-b border-[var(--jasim-border)] bg-[var(--jasim-bg)]/80 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                // An icon-only control with no name is a control a screen
                // reader announces as «زر».
                aria-label="فتح قائمة المحادثات"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <span className="max-w-[200px] truncate text-sm font-medium text-[var(--jasim-text-secondary)]">
              {currentConversation?.title || 'محادثة جديدة'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearMessages}
                className="jasim-action jasim-action--quiet"
              >
                مسح
              </button>
            )}
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
              placeholder="اكتب ما تريد أن يحدث…"
              showSuggestions={true}
              disabled={false}
            />
          </div>
          {/*
            Conversation-first, as a proportion rather than as an intention.
            This column used to claim 62vw, which left the conversation with
            roughly a third of a desktop screen while the workspace and the
            Living Objects rail took the rest. The generated
            surface is the RESULT of the conversation; it should not outrank it.
            The conversation now keeps the majority of the width and the rail is
            a genuine rail rather than a second panel.
          */}
          {/*
            The column is only reserved when there is a conversation for it to
            be about. With none, `ActiveGenerativeWorkspace` returns null and
            the rail is empty — but the column still claimed 38vw, so the
            desktop empty state was a centred conversation with a third of the
            screen held black beside it for nothing.
          */}
          {currentConversation?.id && (
          <div className="flex min-h-0 w-full shrink-0 flex-col gap-2 lg:w-[min(38vw,32rem)] lg:flex-row">
            <ActiveGenerativeWorkspace
              conversationId={currentConversation?.id}
              onPresentationAction={(intent, context) => {
                void dispatchWorkspaceAction(intent, context);
              }}
              onPresentationSubmit={(data, schema, context) => {
                void dispatchWorkspaceSubmit(data, schema, context);
              }}
              className="order-2 max-h-[38dvh] w-full border-t border-[var(--jasim-border)] p-2 lg:order-1 lg:max-h-none lg:min-w-0 lg:flex-1 lg:border-t-0 lg:p-3"
            />
            <ActiveObjectsRail
              onOpen={handleLivingObjectOpen}
              className="order-1 max-h-[14dvh] w-full overflow-hidden lg:order-2 lg:max-h-none lg:w-[min(13vw,11rem)]"
            />
          </div>
          )}
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
