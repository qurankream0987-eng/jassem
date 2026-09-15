import { useState, useRef, useEffect } from 'react';
import { trpc } from '@/providers/trpc';

const SUGGESTIONS = [
  'اطلب طعام',
  'ابحث عن وظيفة',
  'افتح متجر',
  'أنشئ CV',
  'توصيل طلبات',
];

const WELCOME_MSG =
  'مرحباً! أنا جاسم — وكيلك الذكي للتجارة والأعمال. كيف يمكنني مساعدتك اليوم؟';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function MainChat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME_MSG },
  ]);
  const [input, setInput] = useState('');
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isFetching } = trpc.agents.process.useQuery(
    { message: pendingQuery ?? '' },
    {
      enabled: pendingQuery !== null,
      staleTime: 0,
      refetchOnWindowFocus: false,
      onSuccess: (data) => {
        setIsTyping(false);
        const responseText =
          data && typeof data === 'object' && 'response' in data
            ? String(data.response)
            : 'تم المعالجة بنجاح';
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: responseText,
          },
        ]);
        setPendingQuery(null);
      },
      onError: () => {
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.',
          },
        ]);
        setPendingQuery(null);
      },
    } as any
  );

  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, isFetching]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || pendingQuery !== null) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    setPendingQuery(text);
  };

  const handleSuggestion = (suggestion: string) => {
    if (pendingQuery !== null) return;
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: suggestion,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);
    setPendingQuery(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCameraClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '64px',
        left: 0,
        right: 0,
        top: '18vh',
        zIndex: 35,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(0, 0, 17, 0.55)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(0, 212, 255, 0.2)',
        borderRadius: '24px 24px 0 0',
        overflow: 'hidden',
      }}
    >
      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
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
            }}
          >
            {msg.content}
          </div>
        ))}

        {(isTyping || isFetching) && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '12px 16px',
              borderRadius: '16px 16px 16px 4px',
              background: 'rgba(255, 255, 255, 0.06)',
              display: 'flex',
              gap: '4px',
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

        {/* Suggestion chips */}
        {messages.length === 1 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '8px',
              animation: 'fadeUp 0.5s ease 0.3s both',
            }}
          >
            {SUGGESTIONS.map((s) => (
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
          padding: '10px 14px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(0, 0, 17, 0.4)',
        }}
      >
        <button
          onClick={handleCameraClick}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
          title="Camera"
        >
          📷
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={() => {
            /* TODO: handle image upload */
          }}
        />

        <button
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
          title="Voice input"
        >
          🎤
        </button>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="اكتب رسالتك هنا..."
          style={{
            flex: 1,
            height: '40px',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#fff',
            padding: '0 14px',
            fontSize: '14px',
            fontFamily: "'Noto Sans Arabic', sans-serif",
            outline: 'none',
            direction: 'rtl',
          }}
        />

        <button
          onClick={handleSend}
          disabled={!input.trim() || pendingQuery !== null}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: 'none',
            background:
              input.trim() && pendingQuery === null
                ? 'rgba(0, 212, 255, 0.25)'
                : 'rgba(255, 255, 255, 0.06)',
            color:
              input.trim() && pendingQuery === null
                ? '#00d4ff'
                : 'rgba(255, 255, 255, 0.3)',
            cursor: input.trim() && pendingQuery === null ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
