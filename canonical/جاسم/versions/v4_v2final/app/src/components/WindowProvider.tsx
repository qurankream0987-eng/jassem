import { useState, useCallback, useRef, type ReactNode } from "react";
import { WindowContext, type WindowState, type OpenWindowOptions } from "@/context/WindowContext";
import WindowManager from "./WindowManager";
import WindowDock from "./WindowDock";

interface WindowProviderProps {
  children: ReactNode;
}

let idCounter = 0;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 640;

export function WindowProvider({ children }: WindowProviderProps) {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const zIndexRef = useRef(1000);

  const getNextZIndex = useCallback(() => {
    zIndexRef.current += 1;
    return zIndexRef.current;
  }, []);

  const openWindow = useCallback(
    (title: string, content: ReactNode, options?: OpenWindowOptions): string => {
      const id = `window-${++idCounter}`;
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;

      // Offset new windows slightly to avoid perfect overlap
      const offsetX = (windows.length % 5) * 30;
      const offsetY = (windows.length % 5) * 20;

      const width = options?.width ?? DEFAULT_WIDTH;
      const height = options?.height ?? DEFAULT_HEIGHT;

      // Center the window, accounting for offset
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

      const newWindow: WindowState = {
        id,
        title,
        content,
        x,
        y,
        width,
        height,
        zIndex: getNextZIndex(),
        isMinimized: false,
        isMaximized: false,
      };

      setWindows((prev) => [...prev, newWindow]);
      return id;
    },
    [windows.length, getNextZIndex]
  );

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMinimized: true } : w))
    );
  }, []);

  const restoreWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMinimized: false, zIndex: zIndexRef.current + 1 } : w
      )
    );
    zIndexRef.current += 1;
  }, []);

  const activateWindow = useCallback(
    (id: string) => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, zIndex: getNextZIndex() } : w
        )
      );
    },
    [getNextZIndex]
  );

  const updateWindowPosition = useCallback(
    (id: string, x: number, y: number) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, x, y } : w))
      );
    },
    []
  );

  const updateWindowSize = useCallback(
    (id: string, width: number, height: number) => {
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, width, height } : w))
      );
    },
    []
  );

  const activeWindows = windows.filter((w) => !w.isMinimized);
  const minimizedWindows = windows.filter((w) => w.isMinimized);

  return (
    <WindowContext.Provider
      value={{
        activeWindows,
        minimizedWindows,
        openWindow,
        closeWindow,
        minimizeWindow,
        restoreWindow,
        activateWindow,
        updateWindowPosition,
        updateWindowSize,
        getNextZIndex,
      }}
    >
      {children}
      <WindowManager
        windows={windows}
        onClose={closeWindow}
        onMinimize={minimizeWindow}
        onActivate={activateWindow}
        onPositionChange={updateWindowPosition}
        onSizeChange={updateWindowSize}
      />
      <WindowDock
        minimizedWindows={minimizedWindows}
        onRestore={restoreWindow}
      />
    </WindowContext.Provider>
  );
}
