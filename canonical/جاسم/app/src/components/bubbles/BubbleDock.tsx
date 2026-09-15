/**
 * BubbleDock.tsx
 * Horizontal dock for minimized bubbles.
 * Appears at the bottom of the screen. Supports RTL, tooltips,
 * add/remove animations, and click-to-restore.
 */

import { memo, useState, useCallback, type MouseEvent } from "react";
import type { BubbleSchema } from "@contracts/jasim";
import { getBubbleColors, getBubbleIcon } from "./bubble-styles";

export interface MinimizedBubble {
  id: string;
  schema: BubbleSchema;
}

export interface BubbleDockProps {
  bubbles: MinimizedBubble[];
  onRestore: (id: string) => void;
  onClose?: (id: string) => void;
  /** RTL layout */
  rtl?: boolean;
}

export const BubbleDock = memo(function BubbleDock({
  bubbles,
  onRestore,
  onClose,
  rtl = false,
}: BubbleDockProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>, id: string) => {
      setHoveredId(id);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    },
    []
  );

  if (bubbles.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 20,
        background: "rgba(15,23,42,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(100,116,139,0.2)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
        direction: rtl ? "rtl" : "ltr",
        animation: "dockSlideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* Minimized bubble icons */}
      {bubbles.map((b) => (
        <DockItem
          key={b.id}
          bubble={b}
          isHovered={hoveredId === b.id}
          onMouseMove={(e) => handleMouseMove(e, b.id)}
          onMouseLeave={() => setHoveredId(null)}
          onClick={() => onRestore(b.id)}
          onClose={() => onClose?.(b.id)}
        />
      ))}

      {/* Tooltip */}
      {hoveredId && (
        <DockTooltip
          bubble={bubbles.find((b) => b.id === hoveredId)!}
          x={tooltipPos.x}
          y={tooltipPos.y}
        />
      )}

      <style>{`
        @keyframes dockSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes dockItemIn {
          from { opacity: 0; transform: scale(0.5) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
});

// ── Individual Dock Item ──

interface DockItemProps {
  bubble: MinimizedBubble;
  isHovered: boolean;
  onMouseMove: (e: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  onClick: () => void;
  onClose: () => void;
}

const DockItem = memo(function DockItem({
  bubble,
  isHovered,
  onMouseMove,
  onMouseLeave,
  onClick,
  onClose,
}: DockItemProps) {
  const colors = getBubbleColors(bubble.schema.type);
  const icon = getBubbleIcon(bubble.schema.type);

  return (
    <div
      style={{
        position: "relative",
        animation: "dockItemIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <button
        onClick={onClick}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: `2px solid ${colors.glow}66`,
          background: `radial-gradient(circle at 30% 30%, ${colors.bgStart}, ${colors.bgEnd})`,
          boxShadow: isHovered
            ? `0 0 16px ${colors.glow}55, 0 4px 12px rgba(0,0,0,0.3)`
            : `0 2px 8px rgba(0,0,0,0.2)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          cursor: "pointer",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
          transform: isHovered ? "scale(1.15) translateY(-4px)" : "scale(1)",
          position: "relative",
          overflow: "hidden",
        }}
        title={bubble.schema.title}
      >
        {/* Glass highlight */}
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "15%",
            width: "40%",
            height: "25%",
            borderRadius: "50%",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)",
            transform: "rotate(-20deg)",
            pointerEvents: "none",
          }}
        />
        <span style={{ position: "relative", zIndex: 1 }}>{icon}</span>
      </button>

      {/* Verified dot */}
      {bubble.schema.trust.verified && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#22c55e",
            border: "2px solid #0f172a",
            boxShadow: "0 0 4px #22c55eaa",
          }}
        />
      )}

      {/* Close X — shows on hover */}
      {isHovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#ef4444",
            color: "#fff",
            border: "2px solid #0f172a",
            fontSize: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 10,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
});

// ── Tooltip ──

function DockTooltip({
  bubble,
  x,
  y,
}: {
  bubble: MinimizedBubble;
  x: number;
  y: number;
}) {
  const colors = getBubbleColors(bubble.schema.type);
  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y - 52,
        transform: "translateX(-50%)",
        zIndex: 10001,
        background: "rgba(15,23,42,0.95)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${colors.glow}44`,
        borderRadius: 8,
        padding: "6px 12px",
        boxShadow: `0 4px 16px rgba(0,0,0,0.3), 0 0 12px ${colors.glow}18`,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        animation: "dockItemIn 0.12s ease-out",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
        {bubble.schema.title}
      </div>
      <div style={{ fontSize: 10, color: colors.textMuted, textTransform: "capitalize" }}>
        {bubble.schema.type}
      </div>
    </div>
  );
}
