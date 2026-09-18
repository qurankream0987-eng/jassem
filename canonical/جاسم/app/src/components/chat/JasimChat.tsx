import { useRef, useEffect, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatSuggestions } from './ChatSuggestions';
import type { Message, BubbleSchema } from '@contracts/jasim';

// ── Types ────────────────────────────────────────────────────────────────────

export interface JasimChatProps {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  onSendMessage: (content: string, files?: File[]) => void;
  onBubbleClick?: (bubble: BubbleSchema) => void;
  onActionClick?: (actionId: string, bubbleData?: BubbleSchema) => void;
  placeholder?: string;
  showSuggestions?: boolean;
  disabled?: boolean;
  /**
   * Arabic-first means Arabic is the default, not the alternative.
   * This defaulted to `false` and Home never passed it, so the entire empty
   * state — heading, subtitle and all four suggestions — shipped in English
   * while the composer beside it was Arabic. The translations already existed;
   * nothing selected them.
   */
  rtl?: boolean;
}

// ── Typing Indicator ───────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3 my-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
      </div>
      <div className="flex items-center">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

/**
 * The first screen a person sees, at the size of the screen they are on.
 *
 * ─── WHAT WAS MEASURED ──────────────────────────────────────────────────────
 *
 * Every dimension here was a constant, so the block that is correctly
 * proportioned on a phone became a small island on anything larger:
 *
 *              island width   of column    empty above / below
 *   390×844        358px        91.8%          162 / 175   ← fine
 *   834×1112       407px        74.6%          357 / 370
 *   1440×900       407px        35.4%          251 / 264
 *
 * On desktop that is 515px of 765 — 67% of the column — left blank, with the
 * four suggestions 407px wide sitting above a 976px composer. The mismatch is
 * what reads as unfinished, and the 264px of nothing between the last
 * suggestion and the composer sits exactly in the path the eye takes.
 *
 * ─── WHAT CHANGED ───────────────────────────────────────────────────────────
 *
 * Nothing was redesigned: same block, same four suggestions, same order. The
 * fixed sizes became responsive ones, so the content grows into the column it
 * is given instead of leaving it empty. Phone rendering is untouched — every
 * new class is behind `sm:` or `lg:`.
 */
function EmptyState({ onSuggestionClick, rtl = true }: { onSuggestionClick: (prompt: string) => void; rtl?: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center px-4 py-6" dir={rtl ? 'rtl' : 'ltr'}>
      {/*
        Two spacers instead of `justify-center`, because on a wide desktop dead
        centre is the wrong place. An even split left 264px of nothing between
        the last suggestion and the composer — directly in the path from "here
        is what I can do" to the one control that does it. Weighting the slack
        toward the top moves that gap to ~160px while the top barely changes,
        because the space above reads as headroom and the space below reads as
        a hole.

        Only at `lg`. Phone and tablet stay centred: an even split measured
        fine at 162/175 on a phone, and biasing a 1112px-tall portrait screen
        made the block look like it had sunk rather than been placed.
      */}
      <div className="flex-1 lg:flex-[1.8]" aria-hidden />
      <div className="w-full text-center max-w-md md:max-w-lg lg:max-w-2xl">
        <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4 lg:mb-6">
          <svg className="w-8 h-8 lg:w-10 lg:h-10 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-100 mb-2 lg:mb-3">
          {rtl ? 'مرحباً بك في جاسم' : 'Welcome to JASIM'}
        </h1>
        <p className="text-sm lg:text-base text-slate-400 mb-6 lg:mb-8">
          {rtl
            ? 'مساعدك الذكي المتكامل. اطرح سؤالك أو اطلب مساعدة في أي مهمة.'
            : 'Your unified generative executable agent. Ask anything or request help with any task.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 lg:gap-3">
          {[
            {
              label: rtl ? 'إنشاء نموذج' : 'Create a form',
              prompt: rtl
                ? 'أنشئ نموذج تسجيل مع اسم وبريد إلكتروني وهاتف ودولة'
                : 'Create a registration form with name, email, phone, and country fields.',
            },
            {
              label: rtl ? 'قارن الخيارات' : 'Compare options',
              prompt: rtl
                ? 'قارن بين ثلاث خطط أسعار مع الميزات والتقييمات'
                : 'Compare three pricing plans with features and ratings.',
            },
            {
              label: rtl ? 'عرض معرض الصور' : 'Show image gallery',
              prompt: rtl
                ? 'اعرض لي معرض صور لمنتجات نموذجية'
                : 'Show me a gallery of sample product images.',
            },
            {
              label: rtl ? 'تتبع التقدم' : 'Track progress',
              prompt: rtl
                ? 'اعرض شريط تقدم لمهمة حالية بنسبة 65%'
                : 'Show a progress bar for a current task at 65%.',
            },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => onSuggestionClick(item.prompt)}
              className="px-4 py-3 lg:px-5 lg:py-4 rounded-xl bg-slate-800/50 border border-slate-700/50 text-sm lg:text-base text-slate-300 hover:bg-slate-800 hover:text-slate-100 hover:border-slate-600 transition text-left"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 lg:max-h-44" aria-hidden />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function JasimChat({
  messages,
  isLoading,
  isStreaming,
  onSendMessage,
  onBubbleClick,
  onActionClick,
  placeholder,
  showSuggestions = true,
  disabled = false,
  rtl = true,
}: JasimChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSuggestionClick = useCallback(
    (prompt: string) => {
      onSendMessage(prompt);
    },
    [onSendMessage]
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col bg-[var(--jasim-bg)]">
      {/* Messages Area */}
      {hasMessages ? (
        <ScrollArea className="flex-1 px-4 py-2" ref={scrollRef}>
          <div className="max-w-3xl mx-auto">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isStreaming}
                isLast={index === messages.length - 1}
                onActionClick={onActionClick}
                onBubbleClick={onBubbleClick}
              />
            ))}
            {isLoading && !isStreaming && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      ) : (
        <EmptyState onSuggestionClick={handleSuggestionClick} rtl={rtl} />
      )}

      {/* Suggestions */}
      {showSuggestions && hasMessages && !isLoading && !isStreaming && (
        <ChatSuggestions
          onSuggestionClick={(suggestion) => handleSuggestionClick(suggestion.prompt)}
          rtl={rtl}
          visible={true}
        />
      )}

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        disabled={disabled}
        isLoading={isLoading || isStreaming}
        placeholder={placeholder || (rtl ? 'اكتب رسالتك...' : 'Message JASIM...')}
        rtl={rtl}
      />
    </div>
  );
}
