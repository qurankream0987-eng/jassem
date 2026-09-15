import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  threshold?: number;
  onLongPress: (e: React.TouchEvent | React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent | React.TouchEvent) => void;
  onPressStart?: () => void;
  onPressEnd?: () => void;
}

export function useLongPress({
  threshold = 600,
  onLongPress,
  onClick,
  onPressStart,
  onPressEnd,
}: UseLongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const startTimeRef = useRef(0);

  const start = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      isLongPressRef.current = false;
      startTimeRef.current = Date.now();
      onPressStart?.();

      timerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        onLongPress(e);
        onPressEnd?.();
      }, threshold);
    },
    [threshold, onLongPress, onPressStart, onPressEnd]
  );

  const end = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const elapsed = Date.now() - startTimeRef.current;
      if (!isLongPressRef.current && elapsed < threshold) {
        onClick?.(e);
      }

      onPressEnd?.();
    },
    [threshold, onClick, onPressEnd]
  );

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onPressEnd?.();
  }, [onPressEnd]);

  return {
    onMouseDown: start,
    onMouseUp: end,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: end,
    onTouchMove: cancel,
  };
}
