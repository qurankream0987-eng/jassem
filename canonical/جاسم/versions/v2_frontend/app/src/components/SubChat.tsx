import { useState, useRef, useEffect, useCallback } from 'react';
import { trpc } from '@/providers/trpc';
import StreamText from './StreamText';

interface SubChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export interface SubChatProps {
  bubbleId: string;
  bubbleType: string;
  title: string;
}

export default function SubChat({ bubbleId, bubbleType, title }: SubChatProps) {
  const [messages, setMessages] = useState<SubChatMessage[]>([
    {
      id: `welcome-${bubbleId}`,
      role: 'assistant',
      content: `مرحباً! أنا جاسم — مساعدك الذكي. كيف يمكنني مساعدتك بخصوص "${title}"؟`,
      isStreaming: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chatMutation = trpc.jasim.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.response ?? 'تم المعالجة بنجاح',
          isStreaming: true,
        },
      ]);

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
          content: 'عذراً، حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.',
        },
      ]);
      setIsTyping(false);
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isTyping || chatMutation.isPending) return;

    const userMsg: SubChatMessage = {
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

    chatMutation.mutate({
      message: text,
      context: {
        bubbleId,
        bubbleType,
        bubbleTitle: title,
      },
    });
  }, [input, isTyping, chatMutation, bubbleId, bubbleType, title]);

  const handleSuggestion = useCallback(
    (suggestion: string) => {
      if (isTyping || chatMutation.isPending) return;

      const userMsg: SubChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: suggestion,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      setSuggestions([]);

      chatMutation.mutate({
        message: suggestion,
        context: {
          bubbleId,
          bubbleType,
          bubbleTitle: title,
        },
      });
    },
    [isTyping, chatMutation, bubbleId, bubbleType, title]
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'rgba(0, 0, 20, 0.6)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              padding: msg.role === 'user' ? '8px 12px' : '10px 12px',
              borderRadius:
                msg.role === 'user'
                  ? '14px 14px 6px 14px'
                  : '14px 14px 14px 6px',
              background:
                msg.role === 'user'
                  ? 'rgba(0, 212, 255, 0.18)'
                  : 'rgba(255, 255, 255, 0.06)',
              border:
                msg.role === 'user'
                  ? '1px solid rgba(0, 212, 255, 0.2)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
              color: '#fff',
              fontSize: '13px',
              lineHeight: 1.55,
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
                speed={14}
                onComplete={() => handleStreamComplete(msg.id)}
              />
            ) : (
              msg.content
            )}
          </div>
        ))}

        {isTyping && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '10px 14px',
              borderRadius: '14px 14px 14px 6px',
              background: 'rgba(255, 255, 255, 0.06)',
              display: 'flex',
              gap: '4px',
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'rgba(0, 212, 255, 0.7)',
                  display: 'inline-block',
                  animation: `typingBounce 1.2s ease ${i * 0.15}s infinite`,
                }}
              />
            ))}
          </div>
        )}

        {/* Suggestion chips */}
        {suggestions.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '6px',
              animation: 'fadeUp 0.4s ease both',
              direction: 'rtl',
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestion(s)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '14px',
                  border: '1px solid rgba(0, 212, 255, 0.25)',
                  background: 'rgba(0, 212, 255, 0.08)',
                  color: '#00d4ff',
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontFamily: "'Noto Sans Arabic', sans-serif",
                  direction: 'rtl',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 212, 255, 0.18)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 212, 255, 0.08)';
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
          padding: '10px 12px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          background: 'rgba(0, 0, 17, 0.5)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="اكتب هنا..."
          rows={1}
          style={{
            flex: 1,
            minHeight: '36px',
            maxHeight: '100px',
            borderRadius: '18px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#fff',
            padding: '8px 12px',
            fontSize: '13px',
            fontFamily: "'Noto Sans Arabic', sans-serif",
            outline: 'none',
            direction: 'rtl',
            resize: 'none',
            overflow: 'hidden',
            lineHeight: 1.5,
          }}
        />

        <button
          onClick={handleSend}
          disabled={!input.trim() || isTyping || chatMutation.isPending}
          style={{
            width: '36px',
            height: '36px',
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
            fontSize: '16px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
            flex: '0 0 36px',
          }}
        >
          <svg
            width="16"
            height="16"
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
