import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface WindowItem {
  title: string;
  val: string;
  up: boolean;
}

export interface SoapWindowProps {
  id: string;
  title: string;
  subtitle: string;
  iconSvg: string; // raw SVG path content
  iconColor: string;
  iconColor2: string;
  items: WindowItem[];
  footerText: string;
  state: 'normal' | 'maximized' | 'minimized' | 'snapped-left' | 'snapped-right';
  zIndex: number;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onActivate: () => void;
  onPositionChange: (x: number, y: number) => void;
  onSizeChange: (w: number, h: number) => void;
  onSnap?: (zone: 'left' | 'right' | 'maximize') => void;
  defaultX?: number;
  defaultY?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const SNAP_THRESHOLD = 80;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

/* ------------------------------------------------------------------ */
/*  SoapWindow Component                                               */
/* ------------------------------------------------------------------ */
export const SoapWindow: React.FC<SoapWindowProps> = ({
  id,
  title,
  subtitle,
  iconSvg,
  iconColor,
  iconColor2,
  items,
  footerText,
  state,
  zIndex,
  onMinimize,
  onMaximize,
  onClose,
  onActivate,
  onPositionChange,
  onSizeChange,
  onSnap,
  defaultX = 120,
  defaultY = 80,
  defaultWidth = 380,
  defaultHeight = 480,
}) => {
  /* ---- local position / size (used when state === 'normal') ---- */
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });

  /* ---- drag state ---- */
  const [isDragging, setIsDragging] = useState(false);
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragVelocity = useRef({ x: 0, y: 0 });
  const lastMousePos = useRef({ x: 0, y: 0 });
  const velocityTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- resize state ---- */
  const [isResizing, setIsResizing] = useState(false);
  const resizeDir = useRef<string>('');
  const resizeStartMouse = useRef({ x: 0, y: 0 });
  const resizeStartSize = useRef({ w: 0, h: 0 });
  const resizeStartPos = useRef({ x: 0, y: 0 });

  /* ---- refs ---- */
  const windowRef = useRef<HTMLDivElement>(null);

  /* ---- compute current display rect ---- */
  const isMaximized = state === 'maximized';
  const isSnappedLeft = state === 'snapped-left';
  const isSnappedRight = state === 'snapped-right';
  const isDocked = isMaximized || isSnappedLeft || isSnappedRight;

  const displayX = isDocked ? 0 : pos.x;
  const displayY = isDocked ? 0 : pos.y;
  const displayW = isDocked
    ? isMaximized
      ? window.innerWidth
      : window.innerWidth / 2
    : size.w;
  const displayH = isDocked ? window.innerHeight : size.h;

  /* ---- velocity tracking ---- */
  const startVelocityTracking = useCallback(() => {
    lastMousePos.current = { x: dragStartMouse.current.x, y: dragStartMouse.current.y };
    if (velocityTimer.current) clearInterval(velocityTimer.current);
    velocityTimer.current = setInterval(() => {
      // velocity is computed during mousemove; this is a placeholder interval
    }, 16);
  }, []);

  const stopVelocityTracking = useCallback(() => {
    if (velocityTimer.current) {
      clearInterval(velocityTimer.current);
      velocityTimer.current = null;
    }
  }, []);

  /* ---- drag start ---- */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // ignore if clicking a control button
      if ((e.target as HTMLElement).closest('.sw-btn')) return;

      e.preventDefault();
      setIsDragging(true);
      dragStartMouse.current = { x: e.clientX, y: e.clientY };
      dragStartPos.current = { ...pos };
      dragVelocity.current = { x: 0, y: 0 };
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      startVelocityTracking();
      onActivate();
    },
    [pos, onActivate, startVelocityTracking]
  );

  /* ---- touch drag start ---- */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest('.sw-btn')) return;
      const touch = e.touches[0];
      setIsDragging(true);
      dragStartMouse.current = { x: touch.clientX, y: touch.clientY };
      dragStartPos.current = { ...pos };
      dragVelocity.current = { x: 0, y: 0 };
      lastMousePos.current = { x: touch.clientX, y: touch.clientY };
      onActivate();
    },
    [pos, onActivate]
  );

  /* ---- drag move (global) ---- */
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartMouse.current.x;
      const dy = e.clientY - dragStartMouse.current.y;

      // velocity
      const dt = 1;
      dragVelocity.current = {
        x: (e.clientX - lastMousePos.current.x) / dt,
        y: (e.clientY - lastMousePos.current.y) / dt,
      };
      lastMousePos.current = { x: e.clientX, y: e.clientY };

      let newX = dragStartPos.current.x + dx;
      let newY = dragStartPos.current.y + dy;

      // if coming out of snapped/maximized state
      if (isDocked) {
        newX = e.clientX - displayW / 2;
        newY = e.clientY - 20;
        dragStartMouse.current = { x: e.clientX, y: e.clientY };
        dragStartPos.current = { x: newX, y: newY };
      }

      setPos({ x: newX, y: newY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartMouse.current.x;
      const dy = touch.clientY - dragStartMouse.current.y;

      dragVelocity.current = {
        x: touch.clientX - lastMousePos.current.x,
        y: touch.clientY - lastMousePos.current.y,
      };
      lastMousePos.current = { x: touch.clientX, y: touch.clientY };

      let newX = dragStartPos.current.x + dx;
      let newY = dragStartPos.current.y + dy;

      if (isDocked) {
        newX = touch.clientX - displayW / 2;
        newY = touch.clientY - 20;
        dragStartMouse.current = { x: touch.clientX, y: touch.clientY };
        dragStartPos.current = { x: newX, y: newY };
      }

      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      stopVelocityTracking();

      // Snap detection
      const mx = e.clientX;
      const my = e.clientY;
      const sw = window.innerWidth;

      let snapped = false;

      // Left edge snap
      if (mx < SNAP_THRESHOLD) {
        onSnap?.('left');
        snapped = true;
      }
      // Right edge snap
      else if (mx > sw - SNAP_THRESHOLD) {
        onSnap?.('right');
        snapped = true;
      }
      // Top edge snap (maximize)
      else if (my < SNAP_THRESHOLD) {
        onSnap?.('maximize');
        snapped = true;
      }

      if (!snapped) {
        // Velocity-based throw
        const vx = dragVelocity.current.x;
        const vy = dragVelocity.current.y;
        const throwFactor = 0.3;

        let finalX = pos.x + vx * throwFactor;
        let finalY = pos.y + vy * throwFactor;

        // Keep within viewport
        finalX = Math.max(-displayW * 0.7, Math.min(sw - displayW * 0.3, finalX));
        finalY = Math.max(0, Math.min(window.innerHeight - 60, finalY));

        setPos({ x: finalX, y: finalY });
        onPositionChange(finalX, finalY);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      stopVelocityTracking();
      onPositionChange(pos.x, pos.y);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    isDragging,
    isDocked,
    displayW,
    displayH,
    pos,
    onSnap,
    onPositionChange,
    stopVelocityTracking,
  ]);

  /* ---- resize start ---- */
  const handleResizeStart = useCallback(
    (dir: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeDir.current = dir;
      resizeStartMouse.current = { x: e.clientX, y: e.clientY };
      resizeStartSize.current = { ...size };
      resizeStartPos.current = { ...pos };
      onActivate();
    },
    [size, pos, onActivate]
  );

  /* ---- resize move (global) ---- */
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStartMouse.current.x;
      const dy = e.clientY - resizeStartMouse.current.y;
      const dir = resizeDir.current;

      let newW = resizeStartSize.current.w;
      let newH = resizeStartSize.current.h;
      let newX = resizeStartPos.current.x;
      let newY = resizeStartPos.current.y;

      if (dir.includes('e')) newW = Math.max(MIN_WIDTH, resizeStartSize.current.w + dx);
      if (dir.includes('w')) {
        const candidateW = Math.max(MIN_WIDTH, resizeStartSize.current.w - dx);
        newX = resizeStartPos.current.x + (resizeStartSize.current.w - candidateW);
        newW = candidateW;
      }
      if (dir.includes('s')) newH = Math.max(MIN_HEIGHT, resizeStartSize.current.h + dy);
      if (dir.includes('n')) {
        const candidateH = Math.max(MIN_HEIGHT, resizeStartSize.current.h - dy);
        newY = resizeStartPos.current.y + (resizeStartSize.current.h - candidateH);
        newH = candidateH;
      }

      setSize({ w: newW, h: newH });
      if (dir.includes('w') || dir.includes('n')) {
        setPos({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      onSizeChange(size.w, size.h);
      if (resizeDir.current.includes('w') || resizeDir.current.includes('n')) {
        onPositionChange(pos.x, pos.y);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, size, pos, onSizeChange, onPositionChange]);

  /* ---- cursor style based on drag/resize ---- */
  const getCursor = useCallback(() => {
    if (isDragging) return 'grabbing';
    return 'default';
  }, [isDragging]);

  /* ---- don't render if minimized ---- */
  if (state === 'minimized') return null;

  /* ---- dynamic styles ---- */
  const windowStyle: React.CSSProperties = {
    position: 'absolute',
    left: displayX,
    top: displayY,
    width: displayW,
    height: displayH,
    zIndex,
    cursor: getCursor(),
    touchAction: 'none',
  };

  return (
    <div
      ref={windowRef}
      className={`soap-window state-${state}${isDragging ? ' dragging' : ''}`}
      style={windowStyle}
      onMouseDown={onActivate}
      data-id={id}
    >
      <div className="sw-inner">
        {/* Glass background layer */}
        <div className="liquid-glass-bg" />

        {/* ---- Header ---- */}
        <div
          className="sw-header"
          onMouseDown={handleDragStart}
          onTouchStart={handleTouchStart}
          role="button"
          tabIndex={0}
        >
          {/* Icon circle */}
          <div
            className="sw-icon"
            style={{
              background: `linear-gradient(135deg, ${iconColor}, ${iconColor2})`,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
          </div>

          {/* Title group */}
          <div className="sw-title-group">
            <div className="sw-title">{title}</div>
            <div className="sw-subtitle">{subtitle}</div>
          </div>

          {/* Window controls */}
          <div className="sw-controls">
            <button
              className="sw-btn minimize"
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              title="تصغير"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="3" />
              </svg>
            </button>
            <button
              className="sw-btn maximize"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              title="تكبير"
            >
              {state === 'maximized' ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="5" y="9" width="10" height="10" rx="1" />
                  <path d="M9 9V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                </svg>
              )}
            </button>
            <button
              className="sw-btn close"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="إغلاق"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ---- Content ---- */}
        <div className="sw-content">
          {items.map((item, idx) => (
            <div className="sw-item" key={idx}>
              <div className="sw-item-info">
                <span className="sw-item-title">{item.title}</span>
                <span
                  className="sw-item-val"
                  style={{ color: item.up ? '#22c55e' : '#ef4444' }}
                >
                  {item.val}
                </span>
              </div>
              <span className="sw-item-arrow">
                {item.up ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                )}
              </span>
              {/* Hover progress bar */}
              <div className="sw-item-progress" />
            </div>
          ))}
        </div>

        {/* ---- Footer ---- */}
        {footerText && <div className="sw-footer">{footerText}</div>}

        {/* ---- Resize Handles (only in normal state) ---- */}
        {state === 'normal' && (
          <>
            <div
              className="resize-handle n"
              onMouseDown={handleResizeStart('n')}
              style={{ position: 'absolute', top: -4, left: 16, right: 16, height: 8, cursor: 'n-resize' }}
            />
            <div
              className="resize-handle s"
              onMouseDown={handleResizeStart('s')}
              style={{ position: 'absolute', bottom: -4, left: 16, right: 16, height: 8, cursor: 's-resize' }}
            />
            <div
              className="resize-handle e"
              onMouseDown={handleResizeStart('e')}
              style={{ position: 'absolute', top: 16, right: -4, bottom: 16, width: 8, cursor: 'e-resize' }}
            />
            <div
              className="resize-handle w"
              onMouseDown={handleResizeStart('w')}
              style={{ position: 'absolute', top: 16, left: -4, bottom: 16, width: 8, cursor: 'w-resize' }}
            />
            <div
              className="resize-handle ne"
              onMouseDown={handleResizeStart('ne')}
              style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, cursor: 'ne-resize' }}
            />
            <div
              className="resize-handle nw"
              onMouseDown={handleResizeStart('nw')}
              style={{ position: 'absolute', top: -4, left: -4, width: 16, height: 16, cursor: 'nw-resize' }}
            />
            <div
              className="resize-handle se"
              onMouseDown={handleResizeStart('se')}
              style={{ position: 'absolute', bottom: -4, right: -4, width: 16, height: 16, cursor: 'se-resize' }}
            />
            <div
              className="resize-handle sw"
              onMouseDown={handleResizeStart('sw')}
              style={{ position: 'absolute', bottom: -4, left: -4, width: 16, height: 16, cursor: 'sw-resize' }}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default SoapWindow;
