import { useRef, useCallback, useEffect } from "react";

export interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
}

export interface UseWindowDragOptions {
  onDrag: (x: number, y: number) => void;
  onDragEnd?: () => void;
}

export function useWindowDrag(options: UseWindowDragOptions) {
  const dragRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      dragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        initialX: 0,
        initialY: 0,
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
    []
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      e.stopPropagation();

      dragRef.current = {
        isDragging: true,
        startX: touch.clientX,
        startY: touch.clientY,
        initialX: 0,
        initialY: 0,
      };

      document.body.style.userSelect = "none";
    },
    []
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;

      options.onDrag(deltaX, deltaY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - state.startX;
      const deltaY = touch.clientY - state.startY;

      options.onDrag(deltaX, deltaY);
    };

    const handleMouseUp = () => {
      const state = dragRef.current;
      if (!state.isDragging) return;

      dragRef.current.isDragging = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      options.onDragEnd?.();
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
  }, [options]);

  return {
    handleMouseDown,
    handleTouchStart,
    isDragging: () => dragRef.current.isDragging,
  };
}
