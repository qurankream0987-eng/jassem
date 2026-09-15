import { useRef, useCallback, useEffect } from "react";

export interface BubbleDragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
}

export interface BubbleDragOptions {
  onDragStart?: () => void;
  onDrag: (x: number, y: number) => void;
  onDragEnd?: (finalX: number, finalY: number) => void;
}

/**
 * هوك سحب فقاعات المنافذ — الإحداثيات من الزاوية العلوية اليسرى فقط
 * CRITICAL: x,y represent TOP-LEFT corner. NEVER use translate(-50%,-50%).
 */
export function useBubbleDrag(options: BubbleDragOptions) {
  const dragRef = useRef<BubbleDragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  /** بدء السحب — فأرة */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, currentX: number, currentY: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      dragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        initialX: currentX,
        initialY: currentY,
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";

      options.onDragStart?.();
    },
    [options]
  );

  /** بدء السحب — لمس */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent, currentX: number, currentY: number) => {
      const touch = e.touches[0];
      if (!touch) return;
      e.stopPropagation();

      dragRef.current = {
        isDragging: true,
        startX: touch.clientX,
        startY: touch.clientY,
        initialX: currentX,
        initialY: currentY,
      };

      document.body.style.userSelect = "none";

      options.onDragStart?.();
    },
    [options]
  );

  useEffect(() => {
    /** حركة الفأرة أثناء السحب */
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;

      const newX = state.initialX + deltaX;
      const newY = state.initialY + deltaY;

      options.onDrag(newX, newY);
    };

    /** حركة اللمس أثناء السحب */
    const handleTouchMove = (e: TouchEvent) => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      const newX = state.initialX + deltaX;
      const newY = state.initialY + deltaY;

      options.onDrag(newX, newY);
    };

    /** إنهاء السحب */
    const handleEnd = () => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      dragRef.current.isDragging = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      options.onDragEnd?.(state.initialX, state.initialY);
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
  }, [options]);

  return {
    handleMouseDown,
    handleTouchStart,
    isDragging: () => dragRef.current.isDragging,
  };
}
