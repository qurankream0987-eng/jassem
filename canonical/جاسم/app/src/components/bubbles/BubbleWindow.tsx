/**
 * BubbleWindow.tsx
 * Opens a bubble's content inside a WindowProvider-managed window.
 * Wraps SchemaRenderer with a title bar, trust badge, and action buttons.
 * Supports RTL, resizable, minimize/close, and form submission.
 */

import { memo, useCallback, useRef, useState, useEffect, type PointerEvent, type ReactNode } from "react";
import type { BubbleSchema } from "@contracts/jasim";
import { SchemaRenderer } from "@/components/jasim-core/SchemaRenderer";
import {
  X,
  Minus,
  Maximize2,
  GripHorizontal,
  Shield,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

export interface BubbleWindowProps {
  schema: BubbleSchema;
  /** Window position */
  x?: number;
  y?: number;
  /** Window size */
  width?: number;
  height?: number;
  /** Whether window is active (front-most) */
  isActive?: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onActivate: () => void;
  onMove?: (x: number, y: number) => void;
  onResize?: (width: number, height: number) => void;
  onAction?: (actionId: string, schema: BubbleSchema) => void;
  onSubmit?: (data: Record<string, unknown>, schema: BubbleSchema) => void | Promise<void>;
}

export const BubbleWindow = memo(function BubbleWindow({
  schema,
  x = 100,
  y = 100,
  width = 420,
  height = 540,
  isActive = true,
  onClose,
  onMinimize,
  onActivate,
  onMove,
  onResize,
  onAction,
  onSubmit,
}: BubbleWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [size, setSize] = useState({ width, height });
  const [isMaximized, setIsMaximized] = useState(false);
  const [prevState, setPrevState] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ mx: 0, my: 0, w: 0, h: 0 });

  // Sync external position/size changes
  useEffect(() => {
    if (!isDragging) setPos({ x, y });
  }, [x, y, isDragging]);

  useEffect(() => {
    if (!isResizing) setSize({ width, height });
  }, [width, height, isResizing]);

  const rtl = schema.layout?.rtl ?? false;

  // ── Dragging ──
  const handleTitlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isMaximized) return;
      onActivate();
      setIsDragging(true);
      dragStartRef.current = {
        mx: e.clientX,
        my: e.clientY,
        px: pos.x,
        py: pos.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos, isMaximized, onActivate]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (isDragging) {
        const dx = e.clientX - dragStartRef.current.mx;
        const dy = e.clientY - dragStartRef.current.my;
        const newX = Math.max(0, dragStartRef.current.px + dx);
        const newY = Math.max(0, dragStartRef.current.py + dy);
        setPos({ x: newX, y: newY });
        onMove?.(newX, newY);
      }
      if (isResizing) {
        const dw = e.clientX - resizeStartRef.current.mx;
        const dh = e.clientY - resizeStartRef.current.my;
        const newW = Math.max(320, resizeStartRef.current.w + dw);
        const newH = Math.max(280, resizeStartRef.current.h + dh);
        setSize({ width: newW, height: newH });
        onResize?.(newW, newH);
      }
    },
    [isDragging, isResizing, onMove, onResize]
  );

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
    if (isResizing) {
      setIsResizing(false);
    }
  }, [isDragging, isResizing]);

  // ── Resize ──
  const handleResizePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onActivate();
      setIsResizing(true);
      resizeStartRef.current = {
        mx: e.clientX,
        my: e.clientY,
        w: size.width,
        h: size.height,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [size, onActivate]
  );

  // ── Maximize / Restore ──
  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      if (prevState) {
        setPos({ x: prevState.x, y: prevState.y });
        setSize({ width: prevState.w, height: prevState.h });
        onMove?.(prevState.x, prevState.y);
        onResize?.(prevState.w, prevState.h);
      }
      setIsMaximized(false);
    } else {
      setPrevState({ x: pos.x, y: pos.y, w: size.width, h: size.height });
      setPos({ x: 0, y: 0 });
      setSize({ width: window.innerWidth, height: window.innerHeight - 40 });
      onMove?.(0, 0);
      onResize?.(window.innerWidth, window.innerHeight - 40);
      setIsMaximized(true);
    }
  }, [isMaximized, pos, size, prevState, onMove, onResize]);

  // ── Schema action handler ──
  const handleAction = useCallback(
    (actionId: string, _schemaRef: BubbleSchema) => {
      onAction?.(actionId, _schemaRef);
    },
    [onAction]
  );

  const handleSubmit = useCallback(
    (data: Record<string, unknown>, schemaRef: BubbleSchema) => {
      return onSubmit?.(data, schemaRef);
    },
    [onSubmit],
  );

  // ── Trust icon ──
  const TrustIcon =
    schema.trust.level === "system" || schema.trust.level === "trusted"
      ? ShieldCheck
      : schema.trust.level === "verified"
      ? Shield
      : ShieldAlert;

  const trustColor =
    schema.trust.level === "system" || schema.trust.level === "trusted"
      ? "#22c55e"
      : schema.trust.level === "verified"
      ? "#3b82f6"
      : schema.trust.level === "basic"
      ? "#94a3b8"
      : "#f59e0b";

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={onActivate}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        zIndex: isActive ? 1000 : 900,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        background: "rgba(15,23,42,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid ${isActive ? "rgba(100,116,139,0.3)" : "rgba(100,116,139,0.15)"}`,
        boxShadow: isActive
          ? "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)"
          : "0 8px 24px rgba(0,0,0,0.3)",
        overflow: "hidden",
        transition: isDragging || isResizing ? "none" : "box-shadow 0.2s ease",
        direction: rtl ? "rtl" : "ltr",
        animation: "bubbleWindowIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* ── Title Bar ── */}
      <div
        onPointerDown={handleTitlePointerDown}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          cursor: isMaximized ? "default" : "grab",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
          borderBottom: "1px solid rgba(100,116,139,0.12)",
          userSelect: "none",
        }}
      >
        {/* Drag handle */}
        <GripHorizontal
          className="text-slate-500"
          style={{ width: 16, height: 16, flexShrink: 0, opacity: 0.6 }}
        />

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#f1f5f9",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {schema.title}
          </div>
          {schema.subtitle && (
            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {schema.subtitle}
            </div>
          )}
        </div>

        {/* Trust badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 10,
            background: `${trustColor}18`,
            border: `1px solid ${trustColor}33`,
            flexShrink: 0,
          }}
        >
          <TrustIcon
            style={{ width: 12, height: 12, color: trustColor }}
          />
          <span style={{ fontSize: 10, fontWeight: 500, color: trustColor }}>
            {schema.trust.level}
          </span>
        </div>

        {/* Window controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <WindowControlButton onClick={onMinimize} title="Minimize">
            <Minus style={{ width: 12, height: 12 }} />
          </WindowControlButton>
          <WindowControlButton onClick={toggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
            <Maximize2 style={{ width: 12, height: 12 }} />
          </WindowControlButton>
          <WindowControlButton onClick={onClose} danger title="Close">
            <X style={{ width: 12, height: 12 }} />
          </WindowControlButton>
        </div>
      </div>

      {/* ── Content ── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 16,
        }}
      >
        <SchemaRenderer
          schema={schema}
          onAction={handleAction}
          onSubmit={handleSubmit}
        />
      </div>

      {/* ── Resize Handle ── */}
      {!isMaximized && (
        <div
          onPointerDown={handleResizePointerDown}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: "2px",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 9L9 1M5 9L9 5"
              stroke="rgba(148,163,184,0.4)"
              strokeWidth="1.5"
            />
          </svg>
        </div>
      )}

      <style>{`
        @keyframes bubbleWindowIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
});

// ── Window Control Button ──

function WindowControlButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        border: "none",
        background: "transparent",
        color: danger ? "#f87171" : "#94a3b8",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s ease, color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? "rgba(248,113,113,0.15)"
          : "rgba(148,163,184,0.15)";
        e.currentTarget.style.color = danger ? "#fca5a5" : "#e2e8f0";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = danger ? "#f87171" : "#94a3b8";
      }}
    >
      {children}
    </button>
  );
}
