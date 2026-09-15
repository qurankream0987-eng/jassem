import { useRef, useCallback, useState, useEffect } from "react";

export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface ResizeState {
  direction: ResizeDirection;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startLeft: number;
  startTop: number;
}

export interface UseBubbleResizeOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  onResize: (x: number, y: number, width: number, height: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

/**
 * نظام تغيير حجم الفقاعات — ٨ اتجاهات مع تغيير المؤشر
 */
export function useBubbleResize(opts: UseBubbleResizeOptions) {
  const {
    minWidth = 280,
    minHeight = 400,
    maxWidth = Infinity,
    maxHeight = Infinity,
    onResize,
    onResizeStart,
    onResizeEnd,
  } = opts;

  const resizeRef = useRef<ResizeState | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [activeDirection, setActiveDirection] = useState<ResizeDirection | null>(null);

  /** تغيير شكل المؤشر حسب الاتجاه */
  const getResizeCursor = useCallback((dir: ResizeDirection): string => {
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
  }, []);

  /** بدء تغيير الحجم */
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
        startWidth: 0,
        startHeight: 0,
        startLeft: 0,
        startTop: 0,
      };

      setIsResizing(true);
      setActiveDirection(direction);
      document.body.style.userSelect = "none";
      document.body.style.cursor = getResizeCursor(direction);

      onResizeStart?.();
    },
    [getResizeCursor, onResizeStart]
  );

  /** تسجيل بيانات النافذة عند بدء التغيير */
  const setWindowData = useCallback(
    (width: number, height: number, left: number, top: number) => {
      if (resizeRef.current) {
        resizeRef.current.startWidth = width;
        resizeRef.current.startHeight = height;
        resizeRef.current.startLeft = left;
        resizeRef.current.startTop = top;
      }
    },
    []
  );

  useEffect(() => {
    if (!isResizing) return;

    const clamp = (val: number, min: number, max: number) =>
      Math.max(min, Math.min(max, val));

    const applyResize = (clientX: number, clientY: number) => {
      const state = resizeRef.current;
      if (!state) return;

      const deltaX = clientX - state.startX;
      const deltaY = clientY - state.startY;

      let newWidth = state.startWidth;
      let newHeight = state.startHeight;
      let newX = state.startLeft;
      let newY = state.startTop;

      const dir = state.direction;

      // تغيير أفقي — شرق
      if (dir.includes("e")) {
        newWidth = clamp(state.startWidth + deltaX, minWidth, maxWidth);
      }
      // تغيير أفقي — غرب
      if (dir.includes("w")) {
        const proposedWidth = state.startWidth - deltaX;
        if (proposedWidth >= minWidth && proposedWidth <= maxWidth) {
          newWidth = proposedWidth;
          newX = state.startLeft + deltaX;
        }
      }
      // تغيير رأسي — جنوب
      if (dir.includes("s")) {
        newHeight = clamp(state.startHeight + deltaY, minHeight, maxHeight);
      }
      // تغيير رأسي — شمال
      if (dir.includes("n")) {
        const proposedHeight = state.startHeight - deltaY;
        if (proposedHeight >= minHeight && proposedHeight <= maxHeight) {
          newHeight = proposedHeight;
          newY = state.startTop + deltaY;
        }
      }

      onResize(newX, newY, newWidth, newHeight);
    };

    const handleMouseMove = (e: MouseEvent) => {
      applyResize(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      applyResize(touch.clientX, touch.clientY);
    };

    const handleEnd = () => {
      resizeRef.current = null;
      setIsResizing(false);
      setActiveDirection(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      onResizeEnd?.();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isResizing, minWidth, minHeight, maxWidth, maxHeight, onResize, onResizeEnd]);

  return {
    isResizing,
    activeDirection,
    handleResizeStart,
    setWindowData,
    getResizeCursor,
  };
}
