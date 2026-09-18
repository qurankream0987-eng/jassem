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

function EmptyState({ onSuggestionClick, rtl = true }: { onSuggestionClick: (prompt: string) => void; rtl?: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">
          {rtl ? 'مرحباً بك في جاسيم' : 'Welcome to JASIM'}
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          {rtl
            ? 'مساعدك الذكي المتكامل. اطرح سؤالك أو اطلب مساعدة في أي مهمة.'
            : 'Your unified generative executable agent. Ask anything or request help with any task.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
              className="px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 hover:border-slate-600 transition text-left"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
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
