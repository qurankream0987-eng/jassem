import { useCallback, useRef } from "react";
import SoapWindow from "./SoapWindow";
import type { WindowState } from "@/context/WindowContext";

interface WindowManagerProps {
  windows: WindowState[];
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onActivate: (id: string) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  onSizeChange: (id: string, width: number, height: number) => void;
}

export default function WindowManager({
  windows,
  onClose,
  onMinimize,
  onActivate,
  onPositionChange,
  onSizeChange,
}: WindowManagerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(
    (id: string) => {
      onClose(id);
    },
    [onClose]
  );

  const handleMinimize = useCallback(
    (id: string) => {
      onMinimize(id);
    },
    [onMinimize]
  );

  const handleActivate = useCallback(
    (id: string) => {
      onActivate(id);
    },
    [onActivate]
  );

  const activeWindows = windows.filter((w) => !w.isMinimized);

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
      {activeWindows.map((win) => (
        <div key={win.id} style={{ pointerEvents: "auto" }}>
          <SoapWindow
            id={win.id}
            title={win.title}
            subtitle=""
            iconSvg=""
            iconColor="#6366f1"
            iconColor2="#8b5cf6"
            items={[]}
            footerText=""
            state={win.isMaximized ? 'maximized' : 'normal'}
            zIndex={win.zIndex}
            onClose={() => handleClose(win.id)}
            onMinimize={() => handleMinimize(win.id)}
            onMaximize={() => {}}
            onActivate={() => handleActivate(win.id)}
            onPositionChange={(x, y) => onPositionChange(win.id, x, y)}
            onSizeChange={(w, h) => onSizeChange(win.id, w, h)}
            defaultX={win.x}
            defaultY={win.y}
            defaultWidth={win.width}
            defaultHeight={win.height}
          />
        </div>
      ))}
    </div>
  );
}
