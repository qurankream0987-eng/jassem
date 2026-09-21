import { useState, useCallback } from 'react';
import { Copy, Check, Bot, User, Wrench, Info, FileText, Image, File, Play } from 'lucide-react';
import { StreamingText } from './StreamingText';
import type { Message, BubbleSchema, MessageRole } from '@contracts/jasim';
import { MESSAGE_ROLES } from '@contracts/constants';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RunLifecycleCard } from '@/components/runtime/RunLifecycleCard';
import { PresentationRenderer } from '@/components/jasim-core/PresentationRenderer';
import { SafeMarkdownPreview } from './SafeMarkdownPreview';
import { RoutedNotice, TurnSurface } from '@/components/jasim-core/TurnSurface';
import { TrustedProductActionMount } from '@/components/jasim-core/TrustedProductActionMount';
import type { ProductActionPresentation } from '@/components/jasim-core/TrustedProductActionSurface';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  isLast?: boolean;
  onActionClick?: (actionId: string, bubbleData?: BubbleSchema) => void;
  onBubbleClick?: (bubble: BubbleSchema) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isRtlText(text: string): boolean {
  // Simple RTL detection: check if first significant character is Arabic/Hebrew
  const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFF]/;
  return rtlRegex.test(text.slice(0, 100));
}

function getMessageRoleIcon(role: MessageRole) {
  switch (role) {
    case MESSAGE_ROLES.ASSISTANT:
      return <Bot className="w-4 h-4 text-blue-400" />;
    case MESSAGE_ROLES.USER:
      return <User className="w-4 h-4 text-slate-300" />;
    case MESSAGE_ROLES.TOOL:
      return <Wrench className="w-4 h-4 text-amber-400" />;
    case MESSAGE_ROLES.SYSTEM:
      return <Info className="w-4 h-4 text-slate-400" />;
    default:
      return <Bot className="w-4 h-4" />;
  }
}

/**
 * Who a message is from, in the product's own language.
 *
 * These were English in an Arabic-first product — "You" sat above every
 * sentence the user had just written in Arabic. The assistant keeps its proper
 * name, «جاسم», because a name is not a word to translate; everything else is
 * a role and reads as one.
 */
function getMessageRoleLabel(role: MessageRole): string {
  switch (role) {
    case MESSAGE_ROLES.ASSISTANT:
      return 'جاسم';
    case MESSAGE_ROLES.USER:
      return 'أنت';
    case MESSAGE_ROLES.TOOL:
      return 'أداة';
    case MESSAGE_ROLES.SYSTEM:
      return 'النظام';
    default:
      return 'غير معروف';
  }
}

function safeReceiptDisplayContent(message: Message): string {
  const metadata = message.metadata as Record<string, unknown> | undefined;
  const receiptStatus = metadata?.receiptStatus;
  const verificationStatus = metadata?.verificationStatus;
  const isReceipt = typeof receiptStatus === 'string' && typeof metadata?.runId === 'string';
  const hasInternalRuntimeFields = /\b(?:objectPath|renderPath|renderUrl|requestId|provider)\b/u.test(message.content);
  if (!isReceipt || !hasInternalRuntimeFields) return message.content;
  const completedNodes = typeof metadata?.completedNodes === 'number' ? metadata.completedNodes : null;
  const statusLine =
    receiptStatus === 'verified' && verificationStatus === 'VERIFIED'
      ? '✅ تم التحقق من نتيجة Runtime بنجاح.'
      : verificationStatus === 'INCONCLUSIVE'
        ? '⚠️ سُجّلت مخرجات Runtime، لكن التحقق غير حاسم.'
        : verificationStatus === 'PENDING'
          ? '⏳ سُجّلت مخرجات Runtime، لكن التحقق ما زال معلّقًا.'
          : '❌ لم تثبت نتيجة Runtime كنجاح متحقق.';
  return [
    statusLine,
    completedNodes !== null ? `اكتمل ${completedNodes} خطوة/خطوات.` : '',
    'تظهر الصور والمصادر والـlineage من بطاقات النتائج المخصصة، وليس من بيانات تشغيل داخلية.',
  ].filter(Boolean).join('\n');
}

// ── Inline Action Buttons ────────────────────────────────────────────────────

interface InlineActionsProps {
  actions?: Array<{ id: string; label: string; type?: string }>;
  onActionClick?: (actionId: string) => void;
  bubbleData?: BubbleSchema;
}

function InlineActions({ actions, onActionClick, bubbleData }: InlineActionsProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="outline"
          size="sm"
          className="bg-slate-800/60 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white text-xs h-8"
          onClick={() => onActionClick?.(action.id)}
        >
          {action.label}
        </Button>
      ))}
      {bubbleData && (
        <Button
          variant="outline"
          size="sm"
          className="bg-blue-600/20 border-blue-500/30 text-blue-300 hover:bg-blue-600/30 hover:text-blue-200 text-xs h-8"
          onClick={() => onActionClick?.('open-bubble')}
        >
          <Play className="w-3 h-3 mr-1" />
          Open Widget
        </Button>
      )}
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────────────────

function AttachmentPreview({ metadata }: { metadata?: Record<string, unknown> }) {
  const attachments = metadata?.attachments as Array<{ name: string; type: string }> | undefined;
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((att, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300"
        >
          {att.type?.startsWith('image/') ? (
            <Image className="w-3 h-3 text-blue-400" />
          ) : att.type?.startsWith('text/') ? (
            <FileText className="w-3 h-3 text-emerald-400" />
          ) : (
            <File className="w-3 h-3 text-slate-400" />
          )}
          <span className="truncate max-w-[120px]">{att.name}</span>
        </div>
      ))}
    </div>
  );
}

function StructuredCandidates({ metadata }: { metadata?: Record<string, unknown> }) {
  const data = metadata?.structuredData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const candidates = (data as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2">
      {candidates.map((raw, index) => {
        const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const trust = String(item.trust ?? 'unknown');
        const observed = item.observedMoney && typeof item.observedMoney === 'object'
          ? item.observedMoney as Record<string, unknown>
          : null;
        return (
          <div key={String(item.id ?? index)} className="rounded-lg border border-slate-600 bg-slate-900/50 p-2 text-xs">
            <div className="font-medium text-slate-100">
              {String(item.position ?? index + 1)}. {String(item.title ?? '')}
            </div>
            {item.summary ? <div className="mt-1 text-slate-300">{String(item.summary)}</div> : null}
            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
              <span>{String(item.source ?? '')}</span>
              <span>{trust === 'canonical_internal' ? 'canonical' : 'untrusted evidence'}</span>
              {observed ? <span>{String(observed.amountMinor)} {String(observed.currency ?? '')} (observed)</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ChatMessage({
  message,
  isStreaming = false,
  isLast = false,
  onActionClick,
  onBubbleClick,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const displayContent = safeReceiptDisplayContent(message);
  const isRtl = isRtlText(displayContent);
  const isUser = message.role === MESSAGE_ROLES.USER;
  const isAssistant = message.role === MESSAGE_ROLES.ASSISTANT;
  const isSystem = message.role === MESSAGE_ROLES.SYSTEM;
  const isTool = message.role === MESSAGE_ROLES.TOOL;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(displayContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [displayContent]);

  /**
   * A turn the router understood and could not answer with data.
   *
   * `metadata.routed` is written by one branch of the runtime and one only:
   * the branch that produced NO surface — UNAVAILABLE, DENIED, NEEDS_INPUT,
   * BLOCKED_BY_PROVIDER. Its presence IS the fact, so there is no list of
   * states here to drift out of date.
   *
   * The words it carries are still the answer, but they must not be drawn as
   * an ordinary reply: «لا يوجد مصدر بيانات لهذا» in a normal bubble reads as
   * a finding, and a person cannot tell it apart from one.
   */
  const routed = (message.metadata as Record<string, unknown> | undefined)?.routed as
    | { state?: string; cause?: string }
    | undefined;
  const routedState = isAssistant && typeof routed?.state === 'string' ? routed.state : null;

  /**
   * A sensitive product action the turn initiated.
   *
   * The contract came down from the server's registry; this reads it and
   * renders the trusted surface. The conversation carried the INTENT and the
   * surface carries the collection, which is the whole separation.
   */
  const productAction = message.metadata?.productAction as
    | { actionSessionId: string; expiresAt: string; presentation: ProductActionPresentation }
    | undefined;


  const inlineActions = message.metadata?.actions as Array<{ id: string; label: string; type?: string }> | undefined;
  const presentation = message.metadata?.presentation;
  const shouldRenderPresentation =
    isAssistant &&
    Boolean(presentation) &&
    (presentation as { primitive?: unknown } | undefined)?.primitive !== 'TEXT';

  if (isSystem) {
    return (
      <div className="flex justify-center my-3" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/50 border border-slate-700/50">
          {getMessageRoleIcon(message.role)}
          <span className="text-xs text-slate-400">{displayContent}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-3 my-4 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
          isUser
            ? 'bg-blue-600/20 border border-blue-500/30'
            : isTool
            ? 'bg-amber-500/20 border border-amber-500/30'
            : 'bg-slate-800 border border-slate-700'
        }`}
      >
        {getMessageRoleIcon(message.role)}
      </div>

      {/* Message Content */}
      <div className={`flex-1 min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Name + Time */}
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-xs font-medium text-slate-400">
            {getMessageRoleLabel(message.role)}
          </span>
          <span className="text-[10px] text-slate-600">
            {formatTime(message.createdAt)}
          </span>
        </div>

        {/* Bubble */}
        <div
          className={`relative max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-blue-600 text-white rounded-tr-sm'
              : isTool
              ? 'bg-amber-500/10 border border-amber-500/20 text-amber-100 rounded-tl-sm'
              : 'bg-slate-800 border border-slate-700 text-slate-100 rounded-tl-sm'
          }`}
        >
          {/* Content */}
          {productAction ? (
            <TrustedProductActionMount
              actionSessionId={productAction.actionSessionId}
              expiresAt={productAction.expiresAt}
              presentation={productAction.presentation}
            />
          ) : routedState ? (
            <RoutedNotice state={routedState} message={displayContent} />
          ) : isStreaming && isLast && isAssistant ? (
            <StreamingText text={displayContent} speedMs={16} />
          ) : (
            <div className={`prose prose-invert prose-sm max-w-none ${isUser ? 'prose-p:text-white prose-strong:text-white' : ''}`}>
              <MarkdownPreview text={displayContent} />
            </div>
          )}

          {/* Attachments */}
          <AttachmentPreview metadata={message.metadata} />

          {/* Generic discovery candidates */}
          <StructuredCandidates metadata={message.metadata} />

          {/*
            The surface this turn produced — a TABLE, a CHART, and in time
            every other trusted primitive. It sits under the assistant's words
            because the conversation stays primary: the surface is what the
            turn made, not a place the person navigated to.
          */}
          <TurnSurface surface={(message.metadata as Record<string, unknown> | undefined)?.surface} />

          {/* Runtime Presentation IR, validated before it reaches SchemaRenderer */}
          {shouldRenderPresentation ? (
              <PresentationRenderer
                presentation={presentation}
                onAction={(intent) => onActionClick?.(intent, message.bubbleData)}
              />
            ) : null}

          {/* Inline Actions */}
          <InlineActions
            actions={inlineActions}
            bubbleData={message.bubbleData}
            onActionClick={(actionId) => {
              if (actionId === 'open-bubble' && message.bubbleData) {
                onBubbleClick?.(message.bubbleData);
              } else {
                onActionClick?.(actionId, message.bubbleData);
              }
            }}
          />

          {/* Run Lifecycle Card (for durable_run assistant messages) */}
          {isAssistant && (() => {
            const meta = message.metadata as Record<string, unknown> | undefined;
            const runId = typeof meta?.runId === 'string' ? meta.runId : undefined;
            const proposalIds = Array.isArray(meta?.proposalIds)
              ? (meta.proposalIds as unknown[]).map(String)
              : [];
            return runId ? (
              <RunLifecycleCard
                runId={runId}
                proposalIds={proposalIds}
                label={typeof meta?.label === 'string' ? meta.label : undefined}
              />
            ) : null;
          })()}

          {/* Bubble Preview Card (for assistant messages with bubbleData) */}
          {message.bubbleData && isAssistant && (
            <div
              className="mt-3 p-3 rounded-xl bg-slate-900/60 border border-slate-700/50 cursor-pointer hover:bg-slate-900/80 transition-colors"
              onClick={() => onBubbleClick?.(message.bubbleData!)}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-xs font-medium text-blue-300">{message.bubbleData.title}</span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                {message.bubbleData.subtitle || 'Click to open interactive widget'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity self-end ${isRtl ? 'ml-2' : 'mr-2'}`}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{copied ? 'Copied!' : 'Copy'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// ── Re-export MarkdownPreview for use in StreamingText ───────────────────────

function MarkdownPreview({ text }: { text: string }) {
  return <SafeMarkdownPreview text={text} />;
}

export { MarkdownPreview };
