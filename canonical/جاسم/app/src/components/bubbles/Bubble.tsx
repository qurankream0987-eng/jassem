/**
 * Bubble.tsx
 * Individual DOM-based bubble component.
 * Circular glassmorphism bubble with gradient, glow, icon, and title.
 * Supports drag, click, context menu, hover preview.
 */

import { memo, useCallback, useRef, useState, useEffect, type ReactNode, type PointerEvent, type MouseEvent, type CSSProperties } from "react";
import type { BubbleSchema } from "@contracts/jasim";
import { getBubbleColors, getBubbleIcon } from "./bubble-styles";

export interface BubbleProps {
  schema: BubbleSchema;
  /** Center X position */
  x: number;
  /** Center Y position */
  y: number;
  /** Display scale (for hover pop) */
  scale?: number;
  /** Visual opacity */
  opacity?: number;
  /** Whether this bubble is being dragged */
  isDragging?: boolean;
  /** Whether this bubble is being hovered */
  isHovering?: boolean;
  /** Radius in px */
  radius?: number;
  /** Pulse phase for animation */
  pulsePhase?: number;
  /** Callback on click */
  onClick: () => void;
  /** Callback on drag start — passes pointer coordinates */
  onDragStart: (clientX: number, clientY: number) => void;
  /** Callback on drag move */
  onDragMove: (clientX: number, clientY: number) => void;
  /** Callback on drag end */
  onDragEnd: () => void;
  /** Callback on hover change */
  onHoverChange?: (hovering: boolean) => void;
  /** Callback on close from context menu */
  onClose: () => void;
  /** Callback on minimize from context menu */
  onMinimize: () => void;
  /** Callback on pin from context menu */
  onPin?: () => void;
}

export const Bubble = memo(function Bubble({
  schema,
  x,
  y,
  scale = 1,
  opacity = 1,
  isDragging = false,
  isHovering = false,
  radius = 48,
  pulsePhase = 0,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onHoverChange,
  onClose,
  onMinimize,
  onPin,
}: BubbleProps) {
  const colors = getBubbleColors(schema.type);
  const icon = getBubbleIcon(schema.type);
  const size = radius * 2;
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // containerRef is read by potential parent access
  void containerRef;

  // Pulse scale
  const pulseScale = 1 + Math.sin(pulsePhase) * 0.03;
  const finalScale = scale * (isHovering && !isDragging ? 1.12 : 1) * pulseScale;

  // Pointer events — only left-click for drag
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // Only left click
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onDragStart(e.clientX, e.clientY);
    },
    [onDragStart]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      onDragMove(e.clientX, e.clientY);
    },
    [onDragMove]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      onDragEnd();
    },
    [onDragEnd]
  );

  // Context menu
  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setContextPos({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
    },
    []
  );

  // Click outside to close context menu
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = () => setShowContextMenu(false);
    window.addEventListener("click", handleClick, { once: true });
    return () => window.removeEventListener("click", handleClick);
  }, [showContextMenu]);

  // Hide context menu on scroll
  useEffect(() => {
    if (!showContextMenu) return;
    const handleScroll = () => setShowContextMenu(false);
    window.addEventListener("scroll", handleScroll, { once: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [showContextMenu]);

  // RTL support
  const isRTL = schema.layout?.rtl ?? false;

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          left: x - radius,
          top: y - radius,
          width: size,
          height: size,
          transform: `scale(${finalScale})`,
          opacity,
          cursor: isDragging ? "grabbing" : "grab",
          zIndex: isDragging ? 999 : isHovering ? 50 : 10,
          transition:
            isDragging || isHovering
              ? "transform 0.15s ease-out, opacity 0.3s ease"
              : "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease, left 0.05s linear, top 0.05s linear",
          userSelect: "none",
          touchAction: "none",
          direction: isRTL ? "rtl" : "ltr",
          willChange: isDragging ? "transform, left, top" : "transform",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onClick={(e) => {
          // Only trigger click if not dragging (small movement threshold handled by parent)
          if (!isDragging) onClick();
        }}
        role="button"
        aria-label={schema.title}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClick();
        }}
      >
        {/* Outer glow ring */}
        <div
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${colors.glow}22 0%, transparent 70%)`,
            filter: `blur(${isHovering ? 14 : 8}px)`,
            transition: "filter 0.3s ease",
            pointerEvents: "none",
          }}
        />

        {/* Main bubble body */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: `radial-gradient(circle at 30% 30%, ${colors.bgStart}, ${colors.bgEnd})`,
            border: `${isHovering ? 2 : 1.5}px solid ${colors.glow}${isHovering ? "88" : "55"}`,
            boxShadow: isHovering
              ? `0 0 24px ${colors.glow}44, inset 0 0 20px ${colors.glow}18, 0 8px 32px rgba(0,0,0,0.4)`
              : `0 0 16px ${colors.glow}22, inset 0 0 12px ${colors.glow}10, 0 4px 16px rgba(0,0,0,0.3)`,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            transition: "box-shadow 0.3s ease, border 0.3s ease",
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          {/* Inner highlight (glass reflection) */}
          <div
            style={{
              position: "absolute",
              top: "8%",
              left: "15%",
              width: "35%",
              height: "20%",
              borderRadius: "50%",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.02) 100%)",
              transform: "rotate(-25deg)",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Icon */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.max(20, radius * 0.55),
            lineHeight: 1,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
            pointerEvents: "none",
            transform: `scale(${isHovering ? 1.15 : 1})`,
            transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          {icon}
        </div>

        {/* Trust indicator dot */}
        {schema.trust.verified && (
          <div
            style={{
              position: "absolute",
              bottom: "8%",
              right: "8%",
              width: Math.max(8, radius * 0.18),
              height: Math.max(8, radius * 0.18),
              borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 6px #22c55eaa",
              border: "1.5px solid rgba(0,0,0,0.3)",
              pointerEvents: "none",
            }}
          />
        )}

        {/* Title label — shown on hover */}
        <div
          style={{
            position: "absolute",
            top: `calc(100% + 8px)`,
            left: "50%",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: 12,
            fontWeight: 600,
            color: colors.text,
            textShadow: `0 1px 4px ${colors.bgEnd}`,
            opacity: isHovering ? 1 : 0,
            transition: "opacity 0.2s ease, transform 0.2s ease",
            pointerEvents: "none",
            padding: "2px 8px",
            borderRadius: 6,
            background: `rgba(15,23,42,0.7)`,
            backdropFilter: "blur(4px)",
            maxWidth: radius * 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {schema.title}
        </div>

        {/* Hover preview badge (type) */}
        <div
          style={{
            position: "absolute",
            bottom: `calc(100% + 6px)`,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 10,
            fontWeight: 500,
            color: colors.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            opacity: isHovering ? 1 : 0,
            transition: "opacity 0.2s ease",
            pointerEvents: "none",
            padding: "2px 8px",
            borderRadius: 10,
            background: `rgba(15,23,42,0.6)`,
          }}
        >
          {schema.type}
        </div>
      </div>

      {/* Context Menu */}
      {showContextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextPos.x,
            top: contextPos.y,
            zIndex: 10000,
            background: "rgba(15,23,42,0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(100,116,139,0.3)",
            borderRadius: 10,
            padding: "4px 0",
            minWidth: 140,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            animation: "bubbleMenuIn 0.12s ease-out",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem onClick={() => { setShowContextMenu(false); onClick(); }}>
            Open
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { setShowContextMenu(false); onPin?.(); }}>
            Pin
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { setShowContextMenu(false); onMinimize(); }}>
            Minimize
          </ContextMenuItem>
          <div style={{ height: 1, background: "rgba(100,116,139,0.2)", margin: "4px 0" }} />
          <ContextMenuItem danger onClick={() => { setShowContextMenu(false); onClose(); }}>
            Close
          </ContextMenuItem>
        </div>
      )}

      <style>{`
        @keyframes bubbleMenuIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
});

// ── Context Menu Item ──

function ContextMenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 14px",
        fontSize: 13,
        color: danger ? "#f87171" : "#e2e8f0",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        transition: "background 0.1s ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = danger
          ? "rgba(248,113,113,0.1)"
          : "rgba(148,163,184,0.15)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      {children}
    </button>
  );
}
