import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Bubble } from '../../core/bubbles/BubbleEngine.ts';
import { createBubble, updateBubblePhysics, handleBubbleCollision, expandBubble, collapseBubble } from '../../core/bubbles/BubbleEngine.ts';
import { BUBBLE_TYPES } from '../../core/bubbles/BubbleTypes.ts';

interface BubbleCanvasProps {
  width?: number;
  height?: number;
  bubbleCount?: number;
  onBubbleClick?: (bubble: Bubble) => void;
  onBubbleHover?: (bubble: Bubble | null) => void;
}

export const BubbleCanvas: React.FC<BubbleCanvasProps> = ({
  width = 1200,
  height = 600,
  bubbleCount = 12,
  onBubbleClick,
  onBubbleHover,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubblesRef = useRef<Bubble[]>([]);
  const animationRef = useRef<number>(0);
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);

  useEffect(() => {
    const bubbles: Bubble[] = [];
    for (let i = 0; i < bubbleCount; i++) {
      const type = BUBBLE_TYPES[i % BUBBLE_TYPES.length];
      const x = Math.random() * (width - 200) + 100;
      const y = Math.random() * (height - 200) + 100;
      bubbles.push(createBubble(type, x, y));
    }
    bubblesRef.current = bubbles;
  }, [bubbleCount, width, height]);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const state = {
      bubbles: bubblesRef.current,
      selectedBubbleId: null,
      hoveredBubbleId: hoveredBubble,
      canvasWidth: width,
      canvasHeight: height,
      gravity: 0.02,
      wind: 0.01,
      turbulence: 0.05,
      isRunning: true,
      fps: 60,
    };

    for (let i = 0; i < bubblesRef.current.length; i++) {
      bubblesRef.current[i] = updateBubblePhysics(bubblesRef.current[i], state, 16);
    }

    for (let i = 0; i < bubblesRef.current.length; i++) {
      for (let j = i + 1; j < bubblesRef.current.length; j++) {
        const [a, b] = handleBubbleCollision(bubblesRef.current[i], bubblesRef.current[j]);
        bubblesRef.current[i] = a;
        bubblesRef.current[j] = b;
      }
    }

    for (const bubble of bubblesRef.current) {
      drawBubble(ctx, bubble);
    }

    animationRef.current = requestAnimationFrame(animate);
  }, [width, height, hoveredBubble]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [animate]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: Bubble | null = null;
    for (const bubble of bubblesRef.current) {
      const dx = mx - bubble.x;
      const dy = my - bubble.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bubble.radius) {
        found = bubble;
        break;
      }
    }

    if (found) {
      setHoveredBubble(found.id);
      onBubbleHover?.(found);
    } else {
      setHoveredBubble(null);
      onBubbleHover?.(null);
    }
  }, [onBubbleHover]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const bubble of bubblesRef.current) {
      const dx = mx - bubble.x;
      const dy = my - bubble.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bubble.radius) {
        if (bubble.isExpanded) {
          bubblesRef.current = bubblesRef.current.map((b) =>
            b.id === bubble.id ? collapseBubble(b) : b
          );
        } else {
          bubblesRef.current = bubblesRef.current.map((b) =>
            b.id === bubble.id ? expandBubble(b) : collapseBubble(b)
          );
        }
        onBubbleClick?.(bubble);
        break;
      }
    }
  }, [onBubbleClick]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      style={{ width: '100%', height: '100%', cursor: 'pointer' }}
    />
  );
};

function drawBubble(ctx: CanvasRenderingContext2D, bubble: Bubble) {
  const r = bubble.radius * bubble.scale;

  const gradient = ctx.createRadialGradient(
    bubble.x - r * 0.3,
    bubble.y - r * 0.3,
    r * 0.1,
    bubble.x,
    bubble.y,
    r
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(0.5, bubble.type.color + '40');
  gradient.addColorStop(1, bubble.type.color + '20');

  ctx.beginPath();
  ctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = bubble.type.color + '80';
  ctx.lineWidth = 2;
  ctx.stroke();

  const shineR = r * 0.25;
  ctx.beginPath();
  ctx.arc(bubble.x - r * 0.35, bubble.y - r * 0.35, shineR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  if (bubble.isExpanded) {
    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = bubble.type.color + '40';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (bubble.isHovered) {
    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = bubble.type.color + '60';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.globalAlpha = bubble.opacity;
  ctx.globalAlpha = 1;
}
