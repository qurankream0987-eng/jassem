import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import BubbleWindow, { type BubbleWindowData } from "./BubbleWindow";
import { useBubbleSnap } from "@/hooks/useBubbleSnap";
import { playBubbleBirth } from "@/lib/sonic-dna";

export interface BubbleManagerState {
  bubbles: BubbleWindowData[];
  activeId: string | null;
}

export interface BubbleManagerActions {
  openBubble: (
    title: string,
    content: ReactNode,
    options?: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      bubbleType?: string;
    }
  ) => string;
  closeBubble: (id: string) => void;
  minimizeBubble: (id: string) => void;
  restoreBubble: (id: string) => void;
  activateBubble: (id: string) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updateSize: (id: string, w: number, h: number) => void;
}

let bubbleIdCounter = 0;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 640;

export function useBubbleManager(): BubbleManagerState & BubbleManagerActions {
  const [bubbles, setBubbles] = useState<BubbleWindowData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const zIndexRef = useRef(2000);

  const openBubble = useCallback(
    (
      title: string,
      content: ReactNode,
      options?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        bubbleType?: string;
      }
    ): string => {
      const id = `bubble-${++bubbleIdCounter}`;
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;

      const offsetX = (bubbles.filter((b) => !b.minimized).length % 5) * 30;
      const offsetY = (bubbles.filter((b) => !b.minimized).length % 5) * 20;

      const width = options?.width ?? DEFAULT_WIDTH;
      const height = options?.height ?? DEFAULT_HEIGHT;

      const x = Math.max(
        0,
        Math.min(
          screenW - width,
          (options?.x ?? Math.round((screenW - width) / 2)) + offsetX
        )
      );
      const y = Math.max(
        24,
        Math.min(
          screenH - height,
          (options?.y ?? Math.round((screenH - height) / 2)) + offsetY
        )
      );

      const newBubble: BubbleWindowData = {
        id,
        title,
        content,
        x,
        y,
        width,
        height,
        zIndex: (zIndexRef.current += 1),
        minimized: false,
        bubbleType: options?.bubbleType || "default",
      };

      setBubbles((prev) => [...prev, newBubble]);
      setActiveId(id);

      // تشغيل صوت الظهور
      playBubbleBirth(options?.bubbleType || "default");

      return id;
    },
    [bubbles]
  );

  const closeBubble = useCallback((id: string) => {
    setBubbles((prev) => prev.filter((b) => b.id !== id));
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const minimizeBubble = useCallback((id: string) => {
    setBubbles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, minimized: true } : b))
    );
  }, []);

  const restoreBubble = useCallback((id: string) => {
    setBubbles((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, minimized: false, zIndex: (zIndexRef.current += 1) }
          : b
      )
    );
    setActiveId(id);
  }, []);

  const activateBubble = useCallback((id: string) => {
    setBubbles((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, zIndex: (zIndexRef.current += 1) } : b
      )
    );
    setActiveId(id);
  }, []);

  const updatePosition = useCallback((id: string, x: number, y: number) => {
    setBubbles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, x, y } : b))
    );
  }, []);

  const updateSize = useCallback((id: string, w: number, h: number) => {
    setBubbles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, width: w, height: h } : b))
    );
  }, []);

  return {
    bubbles,
    activeId,
    openBubble,
    closeBubble,
    minimizeBubble,
    restoreBubble,
    activateBubble,
    updatePosition,
    updateSize,
  };
}

// ═══════════════════════════════════════════
// المكون المرئي
// ═════════════════━━━━━━━━━━━━━━━━━━━━━━━━━

interface BubbleManagerProps {
  bubbles: BubbleWindowData[];
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onActivate: (id: string) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  onSizeChange: (id: string, w: number, h: number) => void;
}

export default function BubbleManager({
  bubbles,
  onClose,
  onMinimize,
  onActivate,
  onPositionChange,
  onSizeChange,
}: BubbleManagerProps) {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const { snapGuides, activeSnapZone, updateGuides, clearGuides } =
    useBubbleSnap({
      containerWidth: dimensions.width,
      snapDistance: 40,
    });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const activeBubbles = bubbles.filter((b) => !b.minimized);

  // تتبع السحب لتحديث خطوط الالتصاق
  const handlePositionChange = useCallback(
    (id: string, x: number, y: number) => {
      onPositionChange(id, x, y);
      updateGuides(x);
    },
    [onPositionChange, updateGuides]
  );

  const handleDragEnd = useCallback(() => {
    clearGuides();
  }, [clearGuides]);

  // تطبيق التصاق عند وجود منطقة نشطة
  useEffect(() => {
    if (activeSnapZone !== null && activeId) {
      const active = activeBubbles.find((b) => b.id === activeId);
      if (active) {
        const snapPixels = [0, 0.25, 0.5, 0.75].map(
          (pct) => Math.round(dimensions.width * pct)
        );
        const zoneIndex = [0, 25, 50, 75].indexOf(activeSnapZone);
        if (zoneIndex >= 0) {
          const snapX = snapPixels[zoneIndex];
          onPositionChange(activeId, snapX, active.y);
        }
      }
    }
  }, [activeSnapZone]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {activeBubbles.map((bubble) => (
        <div
          key={bubble.id}
          style={{ pointerEvents: "auto" }}
          onMouseUp={handleDragEnd}
          onTouchEnd={handleDragEnd}
        >
          <BubbleWindow
            bubble={bubble}
            containerWidth={dimensions.width}
            containerHeight={dimensions.height}
            onClose={onClose}
            onMinimize={onMinimize}
            onActivate={onActivate}
            onPositionChange={(id, x, y) => handlePositionChange(id, x, y)}
            onSizeChange={onSizeChange}
            snapGuides={
              activeId === bubble.id ? snapGuides : []
            }
          />
        </div>
      ))}
    </div>
  );
}
