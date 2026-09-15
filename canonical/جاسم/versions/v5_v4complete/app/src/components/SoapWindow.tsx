import { useRef, useCallback, useState, useEffect } from "react";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { WindowState } from "@/context/WindowContext";

interface SoapWindowProps {
  window: WindowState;
  onClose: () => void;
  onMinimize: () => void;
  onActivate: () => void;
  onPositionChange: (x: number, y: number) => void;
  onSizeChange: (width: number, height: number) => void;
  containerWidth: number;
  containerHeight: number;
}

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_WIDTH = 280;
const MIN_HEIGHT = 400;
const SNAP_DISTANCE = 40;

export default function SoapWindow({
  window: win,
  onClose,
  onMinimize,
  onActivate,
  onPositionChange,
  onSizeChange,
  containerWidth,
  containerHeight,
}: SoapWindowProps) {
  const winRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [snapGuides, setSnapGuides] = useState<number[]>([]);
  const resizeRef = useRef<{
    direction: ResizeDirection;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  const maxWidth = Math.min(900, containerWidth * 0.9);
  const maxHeight = Math.min(800, containerHeight * 0.9);

  // Calculate snap zones (25% each)
  const snapZones = [
    0,
    Math.round(containerWidth * 0.25),
    Math.round(containerWidth * 0.5),
    Math.round(containerWidth * 0.75),
  ];

  const checkSnap = useCallback(
    (x: number): number | null => {
      for (const zone of snapZones) {
        if (Math.abs(x - zone) < SNAP_DISTANCE) {
          return zone;
        }
      }
      return null;
    },
    [snapZones]
  );

  const dragHandlers = useWindowDrag({
    onDrag: useCallback(
      (deltaX: number, deltaY: number) => {
        setIsDragging(true);
        const newX = Math.max(
          0,
          Math.min(containerWidth - win.width, win.x + deltaX)
        );
        const newY = Math.max(
          24,
          Math.min(containerHeight - 60, win.y + deltaY)
        );

        // Check for snap guides
        const guides: number[] = [];
        for (const zone of snapZones) {
          if (Math.abs(newX - zone) < SNAP_DISTANCE) {
            guides.push(zone);
          }
        }
        setSnapGuides(guides);

        onPositionChange(newX, newY);
      },
      [win.x, win.y, win.width, containerWidth, containerHeight, onPositionChange, snapZones]
    ),
    onDragEnd: useCallback(() => {
      setIsDragging(false);
      setSnapGuides([]);

      // Apply snap if close to a zone
      const snapX = checkSnap(win.x);
      if (snapX !== null) {
        onPositionChange(snapX, win.y);
      }
    }, [win.x, win.y, checkSnap, onPositionChange]),
  });

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent, direction: ResizeDirection) => {
      e.stopPropagation();
      e.preventDefault();

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      resizeRef.current = {
        direction,
        startX: clientX,
        startY: clientY,
        startWidth: win.width,
        startHeight: win.height,
        startLeft: win.x,
        startTop: win.y,
      };

      setIsResizing(true);
      document.body.style.userSelect = "none";
    },
    [win]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;

      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;

      let newWidth = state.startWidth;
      let newHeight = state.startHeight;
      let newX = state.startLeft;
      let newY = state.startTop;

      // Horizontal resize
      if (state.direction.includes("e")) {
        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, state.startWidth + deltaX));
      }
      if (state.direction.includes("w")) {
        const proposedWidth = state.startWidth - deltaX;
        if (proposedWidth >= MIN_WIDTH && proposedWidth <= maxWidth) {
          newWidth = proposedWidth;
          newX = state.startLeft + deltaX;
        }
      }

      // Vertical resize
      if (state.direction.includes("s")) {
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, state.startHeight + deltaY));
      }
      if (state.direction.includes("n")) {
        const proposedHeight = state.startHeight - deltaY;
        if (proposedHeight >= MIN_HEIGHT && proposedHeight <= maxHeight) {
          newHeight = proposedHeight;
          newY = state.startTop + deltaY;
        }
      }

      onPositionChange(newX, newY);
      onSizeChange(newWidth, newHeight);
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
      document.body.style.userSelect = "";
    };

    const handleTouchMove = (e: TouchEvent) => {
      const state = resizeRef.current;
      if (!state) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      let newWidth = state.startWidth;
      let newHeight = state.startHeight;
      let newX = state.startLeft;
      let newY = state.startTop;

      if (state.direction.includes("e")) {
        newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, state.startWidth + deltaX));
      }
      if (state.direction.includes("w")) {
        const proposedWidth = state.startWidth - deltaX;
        if (proposedWidth >= MIN_WIDTH && proposedWidth <= maxWidth) {
          newWidth = proposedWidth;
          newX = state.startLeft + deltaX;
        }
      }
      if (state.direction.includes("s")) {
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, state.startHeight + deltaY));
      }
      if (state.direction.includes("n")) {
        const proposedHeight = state.startHeight - deltaY;
        if (proposedHeight >= MIN_HEIGHT && proposedHeight <= maxHeight) {
          newHeight = proposedHeight;
          newY = state.startTop + deltaY;
        }
      }

      onPositionChange(newX, newY);
      onSizeChange(newWidth, newHeight);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isResizing, maxWidth, maxHeight, onPositionChange, onSizeChange]);

  if (win.isMinimized) return null;

  // Cursor styles for resize handles
  const getResizeCursor = (dir: ResizeDirection): string => {
    switch (dir) {
      case "n":
      case "s":
        return "ns-resize";
      case "e":
      case "w":
        return "ew-resize";
      case "ne":
      case "sw":
        return "nesw-resize";
      case "nw":
      case "se":
        return "nwse-resize";
    }
  };

  return (
    <>
      {/* Snap guide lines */}
      {snapGuides.map((guideX) => (
        <div
          key={guideX}
          style={{
            position: "absolute",
            left: `${guideX}px`,
            top: 0,
            width: "2px",
            height: "100%",
            background: "rgba(0, 212, 255, 0.4)",
            boxShadow: "0 0 12px rgba(0, 212, 255, 0.5)",
            pointerEvents: "none",
            zIndex: win.zIndex - 1,
            animation: "snapPulse 1s ease-in-out infinite",
          }}
        />
      ))}

      <div
        ref={winRef}
        onMouseDown={onActivate}
        style={{
          position: "absolute",
          left: `${win.x}px`,
          top: `${win.y}px`,
          width: `${win.width}px`,
          height: `${win.height}px`,
          zIndex: win.zIndex,
          borderRadius: "24px",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "rgba(0, 0, 20, 0.75)",
          border: "1px solid rgba(0, 212, 255, 0.3)",
          boxShadow:
            "0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "winExpand 0.35s var(--spring) forwards",
          cursor: isDragging ? "grabbing" : "default",
          userSelect: "none",
          minWidth: `${MIN_WIDTH}px`,
          minHeight: `${MIN_HEIGHT}px`,
        }}
      >
        {/* Top bar / drag handle */}
        <div
          onMouseDown={dragHandlers.handleMouseDown}
          onTouchStart={dragHandlers.handleTouchStart}
          style={{
            height: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            borderBottom: "1px solid rgba(0, 212, 255, 0.1)",
            cursor: "grab",
            flexShrink: 0,
          }}
        >
          {/* Minimize button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              border: "1px solid rgba(0, 212, 255, 0.2)",
              background: "rgba(0, 212, 255, 0.08)",
              color: "rgba(255, 255, 255, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s ease",
              fontSize: "14px",
              lineHeight: 1,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.25)";
              e.currentTarget.style.boxShadow = "0 0 12px rgba(0, 212, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {/* Title */}
          <span
            style={{
              color: "white",
              fontSize: "14px",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "200px",
              pointerEvents: "none",
            }}
          >
            {win.title}
          </span>

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              border: "1px solid rgba(255, 80, 80, 0.2)",
              background: "rgba(255, 80, 80, 0.08)",
              color: "rgba(255, 255, 255, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all 0.2s ease",
              fontSize: "14px",
              lineHeight: 1,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 80, 80, 0.3)";
              e.currentTarget.style.boxShadow = "0 0 12px rgba(255, 80, 80, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 80, 80, 0.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content area with electric grid background */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px",
            position: "relative",
            backgroundImage:
              "linear-gradient(rgba(0, 212, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.05) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            cursor: "default",
          }}
        >
          {win.content}
        </div>

        {/* Resize handles - 8 directions */}
        {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map(
          (dir) => (
            <div
              key={dir}
              onMouseDown={(e) => handleResizeStart(e, dir)}
              onTouchStart={(e) => handleResizeStart(e, dir)}
              style={{
                position: "absolute",
                ...getResizeHandlePosition(dir),
                width:
                  dir.length === 2 ? "14px" : dir === "n" || dir === "s" ? "100%" : "14px",
                height:
                  dir.length === 2 ? "14px" : dir === "e" || dir === "w" ? "100%" : "14px",
                cursor: getResizeCursor(dir),
                zIndex: 10,
                opacity: 0,
                transition: "opacity 0.2s ease",
                background:
                  dir.length === 2
                    ? "rgba(0, 212, 255, 0.5)"
                    : "transparent",
                borderRadius: dir.length === 2 ? "50%" : "0",
              }}
              onMouseEnter={(e) => {
                if (dir.length === 2) e.currentTarget.style.opacity = "1";
                else e.currentTarget.style.opacity = "0.3";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "0";
              }}
            />
          )
        )}
      </div>
    </>
  );
}

function getResizeHandlePosition(dir: ResizeDirection): React.CSSProperties {
  switch (dir) {
    case "n":
      return { top: "-5px", left: "10px", right: "10px" };
    case "s":
      return { bottom: "-5px", left: "10px", right: "10px" };
    case "e":
      return { right: "-5px", top: "10px", bottom: "10px" };
    case "w":
      return { left: "-5px", top: "10px", bottom: "10px" };
    case "ne":
      return { top: "-5px", right: "-5px" };
    case "nw":
      return { top: "-5px", left: "-5px" };
    case "se":
      return { bottom: "-5px", right: "-5px" };
    case "sw":
      return { bottom: "-5px", left: "-5px" };
  }
}
