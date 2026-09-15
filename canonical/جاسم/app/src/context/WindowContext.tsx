import { createContext, useContext, type ReactNode } from "react";

export interface WindowState {
  id: string;
  title: string;
  content: ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
}

export interface OpenWindowOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WindowContextValue {
  activeWindows: WindowState[];
  minimizedWindows: WindowState[];
  openWindow: (title: string, content: ReactNode, options?: OpenWindowOptions) => string;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  activateWindow: (id: string) => void;
  updateWindowPosition: (id: string, x: number, y: number) => void;
  updateWindowSize: (id: string, width: number, height: number) => void;
  getNextZIndex: () => number;
}

export const WindowContext = createContext<WindowContextValue | null>(null);

export function useWindowContext(): WindowContextValue {
  const ctx = useContext(WindowContext);
  if (!ctx) {
    throw new Error("useWindowContext must be used within a WindowProvider");
  }
  return ctx;
}
