import { useState, useRef, useEffect, useCallback } from 'react';

// SVG icons as components (NO emojis)
const CopyIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const RegenIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>;
const LikeIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>;
const DislikeIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 2.3l1.38 9a2 2 0 0 0 2 1.7M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>;
const StopIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>;
const ScrollIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>;
const AttachIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
const VoiceIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>;
const SendIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;

export default function MainChat() {
  // State
  const [messages, setMessages] = useState<Array<{id:string; text:string; sender:'user'|'ai'; time:string}>>([
    { id: 'welcome', text: 'مرحباً! أنا جاسم، مساعدك الذكي. كيف يمكنني مساعدتك اليوم؟', sender: 'ai', time: new Date().toLocaleTimeString('ar-SA', {hour:'2-digit', minute:'2-digit'}) }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showScroll, setShowScroll] = useState(false);
  const [suggestions] = useState(['اكتب قصيدة', 'اشرح لي النسبية', 'اقترح أفكار مشروع', 'حل هذه المعادلة']);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  // Scroll to bottom
  const scrollToBottom = () => {
    if (chatRef.current) {
      chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  // Handle scroll for scroll-to-bottom button
  const handleScroll = () => {
    if (!chatRef.current) return;
    const nearBottom = chatRef.current.scrollHeight - chatRef.current.scrollTop - chatRef.current.clientHeight < 100;
    setShowScroll(!nearBottom);
  };

  // Send message
  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString('ar-SA', {hour:'2-digit', minute:'2-digit'});
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, text, sender: 'user', time }]);
    setInput('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    setIsTyping(true);
    scrollToBottom();

    // Simulate AI response
    setTimeout(() => {
      setIsTyping(false);
      const responses = [
        'ممتاز! دعني أُعدّ لك خطة تنفيذية مفصلة...',
        'أولاً: نحتاج لتحديد نموذج الأعمال. هل تريد B2B2C أم B2C فقط؟',
        'ثانياً: البنية التقنية. أنصحك بـ FastAPI للـ Backend وFlutter للواجهة.',
        'هذا سؤال ممتاز! دعني أفكر فيه قليلاً...',
      ];
      const aiText = responses[Math.floor(Math.random() * responses.length)];
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, text: aiText, sender: 'ai', time: new Date().toLocaleTimeString('ar-SA', {hour:'2-digit', minute:'2-digit'}) }]);
      scrollToBottom();
    }, 1800);
  };

  // Handle keydown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Render
  return (
    <div className="main-chat" id="main-chat">
      {/* Messages */}
      <div className="chat-area" ref={chatRef} onScroll={handleScroll}>
        {/* Date divider */}
        <div className="date-divider"><span>اليوم</span></div>

        {/* Map messages */}
        {messages.map((msg, idx) => (
          <div key={msg.id} className={`message-group ${msg.sender}`} style={{ animationDelay: `${idx * 0.1}s` }}>
            <div className="message-bubble">{msg.text}</div>
            {msg.sender === 'ai' && (
              <div className="message-controls">
                <button className="msg-btn" title="نسخ"><CopyIcon /></button>
                <button className="msg-btn" title="إعادة توليد"><RegenIcon /></button>
                <button className="msg-btn" title="أعجبني"><LikeIcon /></button>
                <button className="msg-btn" title="لم يعجبني"><DislikeIcon /></button>
                <span className="msg-time">{msg.time}</span>
              </div>
            )}
            {msg.sender === 'user' && (
              <div className="message-controls">
                <button className="msg-btn" title="نسخ"><CopyIcon /></button>
                <span className="msg-time">{msg.time}</span>
              </div>
            )}
            {/* Chips after last AI message */}
            {msg.sender === 'ai' && idx === messages.length - 1 && (
              <div className="chips-container">
                <div className="chip">أخبرني المزيد</div>
                <div className="chip">اكتب مثالاً</div>
                <div className="chip">طبّق على واقعنا</div>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        <div className={`typing-indicator${isTyping ? '' : ' hidden'}`}>
          <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
        </div>
      </div>

      {/* Scroll to bottom */}
      <button className={`scroll-to-bottom${showScroll ? ' visible' : ''}`} onClick={scrollToBottom}>
        <ScrollIcon />
      </button>

      {/* Suggestion pills */}
      <div className="suggestion-bar">
        {suggestions.map(pill => (
          <div key={pill} className="suggestion-pill" onClick={() => { setInput(pill); textareaRef.current?.focus(); }}>{pill}</div>
        ))}
      </div>

      {/* Composer */}
      <div className="composer">
        <div className="composer-inner">
          <div className="input-area">
            <textarea
              ref={textareaRef}
              placeholder="اكتب رسالتك هنا..."
              rows={1}
              value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={handleKeyDown}
              dir="rtl"
            />
          </div>
          <div className="composer-actions">
            <button className="action-btn attach" title="إرفاق"><AttachIcon /></button>
            <button className="action-btn" title="صوت"><VoiceIcon /></button>
            <button className="send-btn" onClick={sendMessage} title="إرسال"><SendIcon /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
