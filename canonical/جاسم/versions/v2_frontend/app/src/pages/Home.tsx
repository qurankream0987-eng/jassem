import { useState, useCallback, useRef, useMemo } from 'react';
import { createElement } from 'react';
import SpaceCanvas from '@/components/SpaceCanvas';
import FloatingBubbles from '@/components/FloatingBubbles';
import JasimTitle from '@/components/JasimTitle';
import MainChat from '@/components/MainChat';
import type { AIBubbleData } from '@/components/MainChat';
import WindowManager from '@/components/WindowManager';
import BubbleDock from '@/components/BubbleDock';
import type { BubbleWindowData } from '@/components/BubbleWindow';
import SubChat from '@/components/SubChat';
import type { WindowState } from '@/context/WindowContext';

let nextZIndex = 200;
let nextWindowId = 1;

export default function Home() {
  // Layer 45: Window manager state — floating soap glass windows
  const [bubbleWindows, setBubbleWindows] = useState<BubbleWindowData[]>([]);
  const activeWindowsRef = useRef<WindowState[]>([]);

  // Convert BubbleWindowData[] to WindowState[] for WindowManager
  const activeWindows: WindowState[] = useMemo(
    () =>
      bubbleWindows
        .filter((b) => !b.minimized)
        .map((b) => ({
          id: b.id,
          title: b.title,
          content: b.content,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          zIndex: b.zIndex,
          isMinimized: b.minimized,
          isMaximized: false,
        })),
    [bubbleWindows]
  );

  // Keep ref in sync for callbacks
  activeWindowsRef.current = activeWindows;

  // Get next cascade position for new windows
  const getCascadePosition = useCallback(() => {
    const offset = (nextWindowId % 8) * 30;
    return {
      x: 80 + offset,
      y: 60 + offset,
    };
  }, []);

  // Open a new soap window from a bubble click
  const openBubbleWindow = useCallback(
    (bubble: BubbleData) => {
      const { x, y } = getCascadePosition();
      const width = 420;
      const height = 560;

      // Create SubChat as the window content
      const subChatElement = createElement(SubChat, {
        bubbleId: bubble.id,
        bubbleType: bubble.type,
        title: bubble.label,
      });

      const newWindow: BubbleWindowData = {
        id: `win-${nextWindowId++}`,
        title: bubble.label,
        x,
        y,
        width,
        height,
        zIndex: nextZIndex++,
        minimized: false,
        content: subChatElement,
        bubbleType: bubble.type,
      };

      setBubbleWindows((prev) => [...prev, newWindow]);
    },
    [getCascadePosition]
  );

  // Close a window
  const closeWindow = useCallback((id: string) => {
    setBubbleWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  // Minimize a window
  const minimizeWindow = useCallback((id: string) => {
    setBubbleWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: true } : w))
    );
  }, []);

  // Restore (unminimize) a window
  const restoreWindow = useCallback((id: string) => {
    setBubbleWindows((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, minimized: false, zIndex: nextZIndex++ }
          : w
      )
    );
  }, []);

  // Activate (bring to front)
  const activateWindow = useCallback((id: string) => {
    setBubbleWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, zIndex: nextZIndex++ } : w
      )
    );
  }, []);

  // Update window position
  const updatePosition = useCallback(
    (id: string, newX: number, newY: number) => {
      setBubbleWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, x: newX, y: newY } : w))
      );
    },
    []
  );

  // Update window size
  const updateSize = useCallback(
    (id: string, newWidth: number, newHeight: number) => {
      setBubbleWindows((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, width: newWidth, height: newHeight } : w
        )
      );
    },
    []
  );

  // Handle bubbles generated from MainChat AI response
  const handleBubblesGenerated = useCallback(
    (bubbles: AIBubbleData[]) => {
      // Auto-open the first bubble as a window, let others float
      if (bubbles.length > 0) {
        // Open first bubble immediately
        openBubbleWindow(bubbles[0]);

        // Remaining bubbles could be added to a floating notification
        // area or dock for later — for now we just log them
        if (bubbles.length > 1) {
          // eslint-disable-next-line no-console
          console.log('[JASIM] Additional bubbles:', bubbles.slice(1));
        }
      }
    },
    [openBubbleWindow]
  );

  // Handle floating bubble click
  const handleBubbleClick = useCallback(
    (type: string, label: string) => {
      // Check if a window for this bubble type already exists
      const existing = bubbleWindows.find(
        (w) => w.bubbleType === type && !w.minimized
      );
      if (existing) {
        activateWindow(existing.id);
        return;
      }

      // Create a temporary bubble data object and open it
      openBubbleWindow({
        id: `float-${Date.now()}`,
        label,
        image: '',
        type,
      });
    },
    [bubbleWindows, activateWindow, openBubbleWindow]
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#000',
      }}
    >
      {/* ===== Layer 0: Deep space background ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <SpaceCanvas />
      </div>

      {/* ===== Layer 5: Floating soap bubbles ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 15, pointerEvents: 'none' }}>
        <FloatingBubbles onBubbleOpen={handleBubbleClick} />
      </div>

      {/* ===== Layer 10: Floating gradient title ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 20, pointerEvents: 'none' }}>
        <JasimTitle />
      </div>

      {/* ===== Layer 35: Main chat (ALWAYS VISIBLE) ===== */}
      <MainChat onBubblesGenerated={handleBubblesGenerated} />

      {/* ===== Layer 45: Floating soap glass windows ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }}>
        <WindowManager
          windows={activeWindows}
          onClose={closeWindow}
          onMinimize={minimizeWindow}
          onActivate={activateWindow}
          onPositionChange={updatePosition}
          onSizeChange={updateSize}
        />
      </div>

      {/* ===== Layer 50: Bubble dock for minimized windows ===== */}
      <BubbleDock bubbles={bubbleWindows} onRestore={restoreWindow} />
    </div>
  );
}
