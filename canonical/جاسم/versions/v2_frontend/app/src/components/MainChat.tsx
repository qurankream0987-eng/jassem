import { useState, useRef, useEffect, useCallback } from 'react';
import { trpc } from '@/providers/trpc';
import StreamText from './StreamText';

/** Bubble data returned from AI — used to open soap windows */
export interface AIBubbleData {
  id: string;
  label: string;
  type: string;
  image?: string;
}

const WELCOME_MSG =
  'مرحباً! أنا جاسم — وكيلك الذكي الشامل. كيف يمكنني مساعدتك اليوم؟';

const DEFAULT_SUGGESTIONS = [
  'اطلب طعام',
  'ابحث عن وظيفة',
  'افتح متجر',
  'أنشئ CV',
  'توصيل طلبات',
];

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export interface MainChatProps {
  onBubblesGenerated?: (bubbles: AIBubbleData[]) => void;
}

export default function MainChat({ onBubblesGenerated }: MainChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME_MSG, isStreaming: true },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chatMutation = trpc.jasim.chat.useMutation({
    onSuccess: (data) => {
      // Add AI response message with streaming
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.response ?? 'تم المعالجة بنجاح',
          isStreaming: true,
        },
      ]);

      // If bubbles returned, pass them up to Home
      if (data.bubbles && data.bubbles.length > 0) {
        onBubblesGenerated?.(data.bubbles);
      }

      // Show suggestion actions from AI
      if (data.actions && data.actions.length > 0) {
        setSuggestions(data.actions.map((a: { label: string }) => a.label));
      } else {
        setSuggestions([]);
      }

      setIsTyping(false);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content:
            'عذراً، حدث خطأ في الاتصال بجاسم. يرجى المحاولة مرة أخرى.',
        },
      ]);
      setSuggestions([]);
      setIsTyping(false);
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isTyping || chatMutation.isPending) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    setSuggestions([]);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    chatMutation.mutate({ message: text });
  }, [input, isTyping, chatMutation]);

  const handleSuggestion = useCallback(
    (suggestion: string) => {
      if (isTyping || chatMutation.isPending) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: suggestion,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      setSuggestions([]);

      chatMutation.mutate({ message: suggestion });
    },
    [isTyping, chatMutation]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStreamComplete = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
    );
  }, []);

  const hasOnlyWelcomeMessage = messages.length === 1;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 35,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(0, 0, 17, 0.6)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(0, 212, 255, 0.2)',
        borderRadius: '24px 24px 0 0',
        overflow: 'hidden',
        maxHeight: '70vh',
        transition: 'max-height 0.3s ease',
      }}
    >
      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          minHeight: 0,
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius:
                msg.role === 'user'
                  ? '16px 16px 6px 16px'
                  : '16px 16px 16px 6px',
              background:
                msg.role === 'user'
                  ? 'rgba(0, 212, 255, 0.2)'
                  : 'rgba(255, 255, 255, 0.08)',
              border:
                msg.role === 'user'
                  ? '1px solid rgba(0, 212, 255, 0.25)'
                  : '1px solid rgba(255, 255, 255, 0.1)',
              color: '#fff',
              fontSize: '14px',
              lineHeight: 1.6,
              animation: 'msgIn 0.35s ease forwards',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              direction: 'rtl',
              textAlign: 'right',
            }}
          >
            {msg.role === 'assistant' && msg.isStreaming ? (
              <StreamText
                text={msg.content}
                speed={16}
                onComplete={() => handleStreamComplete(msg.id)}
              />
            ) : (
              msg.content
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '12px 16px',
              borderRadius: '16px 16px 16px 6px',
              background: 'rgba(255, 255, 255, 0.06)',
              display: 'flex',
              gap: '4px',
              animation: 'msgIn 0.25s ease forwards',
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: 'rgba(0, 212, 255, 0.7)',
                  display: 'inline-block',
                  animation: `typingBounce 1.2s ease ${i * 0.15}s infinite`,
                }}
              />
            ))}
          </div>
        )}

        {/* Suggestion chips — show after welcome or after AI responses */}
        {suggestions.length > 0 && !isTyping && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '4px',
              paddingBottom: '4px',
              animation: 'fadeUp 0.5s ease both',
              direction: 'rtl',
              justifyContent: 'flex-start',
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '16px',
                  border: '1px solid rgba(0, 212, 255, 0.25)',
                  background: 'rgba(0, 212, 255, 0.08)',
                  color: '#00d4ff',
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontFamily: "'Noto Sans Arabic', sans-serif",
                  direction: 'rtl',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 212, 255, 0.18)';
                  e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 212, 255, 0.08)';
                  e.currentTarget.style.borderColor =
                    'rgba(0, 212, 255, 0.25)';
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div
        style={{
          padding: '10px 14px 14px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          background: 'rgba(0, 0, 17, 0.4)',
        }}
      >
        {/* Camera button */}
        <button
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
            flex: '0 0 40px',
          }}
          title="إرفاق صورة"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>

        {/* Voice button */}
        <button
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
            flex: '0 0 40px',
          }}
          title="إدخال صوتي"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>

        {/* Textarea input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="اكتب رسالتك هنا..."
          rows={1}
          style={{
            flex: 1,
            minHeight: '44px',
            maxHeight: '120px',
            borderRadius: '22px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#fff',
            padding: '10px 16px',
            fontSize: '14px',
            fontFamily: "'Noto Sans Arabic', sans-serif",
            outline: 'none',
            direction: 'rtl',
            resize: 'none',
            overflow: 'hidden',
            lineHeight: 1.5,
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!input.trim() || isTyping || chatMutation.isPending}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background:
              input.trim() && !isTyping && !chatMutation.isPending
                ? 'rgba(0, 212, 255, 0.25)'
                : 'rgba(255, 255, 255, 0.06)',
            color:
              input.trim() && !isTyping && !chatMutation.isPending
                ? '#00d4ff'
                : 'rgba(255, 255, 255, 0.3)',
            cursor:
              input.trim() && !isTyping && !chatMutation.isPending
                ? 'pointer'
                : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
            flex: '0 0 44px',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
