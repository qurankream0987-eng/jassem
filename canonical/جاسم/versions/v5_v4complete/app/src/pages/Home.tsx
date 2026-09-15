import { useState, useCallback } from 'react';
import SpaceCanvas from '@/components/SpaceCanvas';
import FloatingBubbles from '@/components/FloatingBubbles';
import JasimTitle from '@/components/JasimTitle';
import MainChat from '@/components/MainChat';
import ChatBubble from '@/components/ChatBubble';
import BottomNav from '@/components/BottomNav';

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);

  const handleBubbleOpen = useCallback((type: string, label: string) => {
    // eslint-disable-next-line no-console
    console.log('[JASIM] Bubble clicked:', type, label);
    // Future: open corresponding agent window
    // For now, toggle the chat with context
    setChatOpen(true);
  }, []);

  const toggleChat = useCallback(() => {
    setChatOpen((prev) => !prev);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#000',
      }}
    >
      {/* Layer 0: Space background */}
      <SpaceCanvas />

      {/* Layer 5: Floating bubbles */}
      <FloatingBubbles onBubbleOpen={handleBubbleOpen} />

      {/* Layer 10: Title */}
      <JasimTitle />

      {/* Layer 35: Chat panel */}
      {chatOpen && <MainChat />}

      {/* Layer 40: Chat toggle bubble */}
      <ChatBubble isOpen={chatOpen} onToggle={toggleChat} />

      {/* Layer 50: Bottom navigation */}
      <BottomNav />
    </div>
  );
}
