import { useRef, useCallback, useState, type ReactNode } from "react";
import { useBubbleDrag } from "@/hooks/useBubbleDrag";
import { useBubbleResize } from "@/hooks/useBubbleResize";
import type { ResizeDirection } from "@/hooks/useBubbleResize";
import { playBubbleBirth, playBubbleDeath } from "@/lib/sonic-dna";

export interface BubbleWindowData {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  content: ReactNode;
  bubbleType?: string;
}

interface BubbleWindowProps {
  bubble: BubbleWindowData;
  containerWidth: number;
  containerHeight: number;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onActivate: (id: string) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  onSizeChange: (id: string, w: number, h: number) => void;
  snapGuides?: { x: number; label: string }[];
}

const MIN_WIDTH = 280;
const MIN_HEIGHT = 400;

export default function BubbleWindow({
  bubble,
  containerWidth,
  containerHeight,
  onClose,
  onMinimize,
  onActivate,
  onPositionChange,
  onSizeChange,
  snapGuides = [],
}: BubbleWindowProps) {
  const winRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  const maxWidth = Math.min(containerWidth * 0.9, 900);
  const maxHeight = Math.min(containerHeight * 0.9, 800);

  // تشغيل صوت الظهور عند الإنشاء
  const hasPlayedBirth = useRef(false);
  if (!hasPlayedBirth.current && !bubble.minimized) {
    hasPlayedBirth.current = true;
    playBubbleBirth(bubble.bubbleType || "default");
  }

  /** تغيير الموضع مع الحدود */
  const clampPosition = useCallback(
    (x: number, y: number) => {
      const clampedX = Math.max(0, Math.min(containerWidth - bubble.width, x));
      const clampedY = Math.max(24, Math.min(containerHeight - 60, y));
      return { x: clampedX, y: clampedY };
    },
    [containerWidth, containerHeight, bubble.width]
  );

  /** هوك السحب */
  const dragHandlers = useBubbleDrag({
    onDragStart: () => setIsDragging(true),
    onDrag: useCallback(
      (x: number, y: number) => {
        const { x: cx, y: cy } = clampPosition(x, y);
        onPositionChange(bubble.id, cx, cy);
      },
      [bubble.id, clampPosition, onPositionChange]
    ),
    onDragEnd: useCallback(() => {
      setIsDragging(false);
    }, []),
  });

  /** هوك تغيير الحجم */
  const {
    isResizing,
    handleResizeStart: startResize,
    setWindowData,
  } = useBubbleResize({
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxWidth,
    maxHeight,
    onResize: useCallback(
      (x: number, y: number, w: number, h: number) => {
        onPositionChange(bubble.id, x, y);
        onSizeChange(bubble.id, w, h);
      },
      [bubble.id, onPositionChange, onSizeChange]
    ),
  });

  /** بدء تغيير الحجم مع بيانات النافذة */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent, dir: ResizeDirection) => {
      setWindowData(bubble.width, bubble.height, bubble.x, bubble.y);
      startResize(e, dir);
    },
    [bubble.width, bubble.height, bubble.x, bubble.y, setWindowData, startResize]
  );

  /** إغلاق النافذة بتأثير صوتي ومرئي */
  const handleClose = useCallback(() => {
    setClosing(true);
    playBubbleDeath(bubble.bubbleType || "default");
    setTimeout(() => onClose(bubble.id), 300);
  }, [bubble.id, bubble.bubbleType, onClose]);

  /** تصغير النافذة */
  const handleMinimize = useCallback(() => {
    onMinimize(bubble.id);
  }, [bubble.id, onMinimize]);

  /** تفعيل النافذة عند الضغط */
  const handleActivate = useCallback(() => {
    onActivate(bubble.id);
  }, [bubble.id, onActivate]);

  /** تنسيق مقابض التغيير */
  const getHandleStyle = (dir: ResizeDirection): React.CSSProperties => {
    const isCorner = dir.length === 2;
    const base: React.CSSProperties = {
      position: "absolute",
      zIndex: 10,
      transition: "opacity 0.2s ease",
    };

    switch (dir) {
      case "n":
        return { ...base, top: -5, left: 10, right: 10, height: 10, cursor: "ns-resize" };
      case "s":
        return { ...base, bottom: -5, left: 10, right: 10, height: 10, cursor: "ns-resize" };
      case "e":
        return { ...base, right: -5, top: 10, bottom: 10, width: 10, cursor: "ew-resize" };
      case "w":
        return { ...base, left: -5, top: 10, bottom: 10, width: 10, cursor: "ew-resize" };
      case "ne":
        return { ...base, top: -5, right: -5, width: 14, height: 14, cursor: "nesw-resize" };
      case "nw":
        return { ...base, top: -5, left: -5, width: 14, height: 14, cursor: "nwse-resize" };
      case "se":
        return { ...base, bottom: -5, right: -5, width: 14, height: 14, cursor: "nwse-resize" };
      case "sw":
        return { ...base, bottom: -5, left: -5, width: 14, height: 14, cursor: "nesw-resize" };
      default:
        return base;
    }
  };

  if (bubble.minimized && !closing) return null;

  return (
    <>
      {/* خطوط التصاق مرئية */}
      {snapGuides.map((guide) => (
        <div
          key={guide.x}
          className="soap-snap-guide"
          style={{
            left: `${guide.x}px`,
            zIndex: bubble.zIndex - 1,
          }}
          title={guide.label}
        />
      ))}

      {/* النافذة الرئيسية */}
      <div
        ref={winRef}
        onMouseDown={handleActivate}
        style={{
          position: "absolute",
          left: `${bubble.x}px`,
          top: `${bubble.y}px`,
          width: `${bubble.width}px`,
          height: `${bubble.height}px`,
          zIndex: bubble.zIndex,
          borderRadius: "24px",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "rgba(0, 0, 20, 0.75)",
          border: "1px solid rgba(0, 212, 255, 0.3)",
          boxShadow: isDragging
            ? "0 16px 48px rgba(0, 212, 255, 0.2), 0 8px 32px rgba(0, 0, 0, 0.5)"
            : "0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: closing ? "winClose 0.3s ease-in forwards" : "winExpand 0.35s var(--spring) forwards",
          cursor: isDragging ? "grabbing" : "default",
          userSelect: "none",
          minWidth: MIN_WIDTH,
          minHeight: MIN_HEIGHT,
          transition: isDragging || isResizing ? "none" : "box-shadow 0.3s ease",
        }}
      >
        {/* الشريط العلوي — مقبض السحب */}
        <div
          onMouseDown={(e) => dragHandlers.handleMouseDown(e, bubble.x, bubble.y)}
          onTouchStart={(e) => dragHandlers.handleTouchStart(e, bubble.x, bubble.y)}
          style={{
            height: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            borderBottom: "1px solid rgba(0, 212, 255, 0.1)",
            cursor: "grab",
            flexShrink: 0,
            background: "rgba(0, 0, 20, 0.4)",
          }}
        >
          {/* زر التصغير ▁ */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMinimize();
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
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.25)";
              e.currentTarget.style.boxShadow = "0 0 12px rgba(0, 212, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
            title="تصغير"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="2" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {/* مقبض السحب — خطوط */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              alignItems: "center",
              pointerEvents: "none",
              opacity: 0.4,
            }}
          >
            <div style={{ width: "20px", height: "2px", background: "rgba(0,212,255,0.4)", borderRadius: "1px" }} />
            <div style={{ width: "20px", height: "2px", background: "rgba(0,212,255,0.4)", borderRadius: "1px" }} />
            <div style={{ width: "20px", height: "2px", background: "rgba(0,212,255,0.4)", borderRadius: "1px" }} />
          </div>

          {/* العنوان */}
          <span
            style={{
              color: "white",
              fontSize: "13px",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "140px",
              pointerEvents: "none",
              textAlign: "center",
              flex: 1,
              padding: "0 8px",
            }}
          >
            {bubble.title}
          </span>

          {/* مقبض السحب — خطوط (يمين) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              alignItems: "center",
              pointerEvents: "none",
              opacity: 0.4,
            }}
          >
            <div style={{ width: "20px", height: "2px", background: "rgba(0,212,255,0.4)", borderRadius: "1px" }} />
            <div style={{ width: "20px", height: "2px", background: "rgba(0,212,255,0.4)", borderRadius: "1px" }} />
            <div style={{ width: "20px", height: "2px", background: "rgba(0,212,255,0.4)", borderRadius: "1px" }} />
          </div>

          {/* زر الإغلاق ✕ */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
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
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 80, 80, 0.3)";
              e.currentTarget.style.boxShadow = "0 0 12px rgba(255, 80, 80, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 80, 80, 0.08)";
              e.currentTarget.style.boxShadow = "none";
            }}
            title="إغلاق"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* منطقة المحتوى — شبكة كهربائية */}
        <div
          className="soap-window-content"
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
          {bubble.content}
        </div>

        {/* مقابض تغيير الحجم — ٨ اتجاهات */}
        {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map(
          (dir) => (
            <div
              key={dir}
              onMouseDown={(e) => handleResizeStart(e, dir)}
              onTouchStart={(e) => handleResizeStart(e, dir)}
              style={{
                ...getHandleStyle(dir),
                opacity: 0,
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
