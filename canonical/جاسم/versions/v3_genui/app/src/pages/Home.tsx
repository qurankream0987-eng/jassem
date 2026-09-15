import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import SpaceCanvas from '@/components/SpaceCanvas';
import BubbleCanvas from '@/components/BubbleCanvas';
import type { BubbleData } from '@/components/BubbleCanvas';
import FloatingTitle from '@/components/FloatingTitle';
import MainChat from '@/components/MainChat';

// Direct GenUI imports
import { classifyIntent, isIntentClear, getBubbleIconSvg } from '../core/genui/intent-classifier';
import { generateBubble, generateWelcomeBubbles } from '../core/genui/bubble-generator';
import { expressionToBubbleData } from '../core/genui/index';
import type { BubbleExpression, BubbleType, IntentResult } from '../core/genui/types';

interface Particle { id: number; x: number; y: number; tx: number; ty: number; color: string; size: number; duration: number; }

export default function HomeTest() {
  const [expressions, setExpressions] = useState<BubbleExpression[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const nextParticleId = useRef(0);

  useEffect(() => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const welcome = generateWelcomeBubbles(screenW, screenH);
    setExpressions(welcome);
  }, []);

  const bubbleData: BubbleData[] = useMemo(() => {
    return expressions.map(expressionToBubbleData);
  }, [expressions]);

  const handleBubbleClick = useCallback((bubble: BubbleData, _sx: number, _sy: number) => {
    // Bubble clicked
  }, []);

  const handleBubblePop = useCallback((_x: number, _y: number, color: string) => {
    // Bubble popped
  }, []);

  const handleSendMessage = useCallback((text: string) => {
    const intent = classifyIntent(text);
    if (isIntentClear(intent)) {
      const positions = expressions.map((e) => ({ x: e.position.x, y: e.position.y, r: e.radius }));
      const newExpr = generateBubble(intent, positions, window.innerWidth, window.innerHeight);
      setExpressions((prev) => [...prev, newExpr]);
    }
  }, [expressions]);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000' }}>
      <SpaceCanvas />
      <div style={{ position: 'fixed', inset: 0, zIndex: 15 }}>
        <BubbleCanvas bubbles={bubbleData} onBubbleClick={handleBubbleClick} onBubblePop={handleBubblePop} />
      </div>
      <FloatingTitle />
      <MainChat onSendMessage={handleSendMessage} />
    </div>
  );
}
