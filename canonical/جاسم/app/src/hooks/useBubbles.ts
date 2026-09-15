import { useState, useCallback } from 'react';
import type { BubbleSchema } from '@contracts/jasim';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FloatingBubble {
  schema: BubbleSchema;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isClosed: boolean;
}

export interface UseBubblesReturn {
  bubbles: FloatingBubble[];
  activeBubble: FloatingBubble | null;
  spawnBubble: (schema: BubbleSchema) => void;
  closeBubble: (id: string) => void;
  minimizeBubble: (id: string) => void;
  restoreBubble: (id: string) => void;
  updateBubbleData: (id: string, data: Record<string, unknown>) => void;
  updateBubblePosition: (id: string, x: number, y: number) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRandomPosition(): { x: number; y: number } {
  const margin = 80;
  const maxX = typeof window !== 'undefined' ? window.innerWidth - 400 - margin : 800;
  const maxY = typeof window !== 'undefined' ? window.innerHeight - 500 - margin : 500;
  return {
    x: margin + Math.random() * maxX,
    y: margin + Math.random() * maxY,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBubbles(): UseBubblesReturn {
  const [bubbles, setBubbles] = useState<FloatingBubble[]>([]);

  const spawnBubble = useCallback((schema: BubbleSchema) => {
    const pos = getRandomPosition();
    setBubbles((prev) => [
      ...prev,
      {
        schema,
        x: pos.x,
        y: pos.y,
        width: 380,
        height: 480,
        isMinimized: false,
        isClosed: false,
      },
    ]);
  }, []);

  const closeBubble = useCallback((id: string) => {
    setBubbles((prev) => prev.filter((b) => b.schema.id !== id));
  }, []);

  const minimizeBubble = useCallback((id: string) => {
    setBubbles((prev) =>
      prev.map((b) => (b.schema.id === id ? { ...b, isMinimized: true } : b))
    );
  }, []);

  const restoreBubble = useCallback((id: string) => {
    setBubbles((prev) =>
      prev.map((b) => (b.schema.id === id ? { ...b, isMinimized: false } : b))
    );
  }, []);

  const updateBubbleData = useCallback((id: string, data: Record<string, unknown>) => {
    setBubbles((prev) =>
      prev.map((b) =>
        b.schema.id === id
          ? { ...b, schema: { ...b.schema, data: { ...b.schema.data, ...data } } }
          : b
      )
    );
  }, []);

  const updateBubblePosition = useCallback((id: string, x: number, y: number) => {
    setBubbles((prev) =>
      prev.map((b) => (b.schema.id === id ? { ...b, x, y } : b))
    );
  }, []);

  const activeBubble = bubbles.find((b) => !b.isMinimized && !b.isClosed) || null;

  return {
    bubbles,
    activeBubble,
    spawnBubble,
    closeBubble,
    minimizeBubble,
    restoreBubble,
    updateBubbleData,
    updateBubblePosition,
  };
}
