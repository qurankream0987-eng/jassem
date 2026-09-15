/**
 * BubbleCanvas.tsx
 * Canvas 2D physics-based bubble system for JASIM.
 *
 * Features:
 *   • Canvas 2D rendering with gradients, glow, glassmorphism, pulse
 *   • Physics-driven floating (sine waves, gravity, friction, bounce)
 *   • Soft collision between bubbles
 *   • Mouse/touch repulsion
 *   • Click to expand into WindowProvider window
 *   • Drag to move
 *   • Connection lines between nearby bubbles
 *   • Minimized bubbles dock at bottom via BubbleDock
 *   • Full RTL and touch support
 */

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { BubbleSchema } from "@contracts/jasim";
import { useWindowContext } from "@/context/WindowContext";
import { SchemaRenderer } from "@/components/jasim-core/SchemaRenderer";
import { useBubblePhysics } from "./useBubblePhysics";
import { BubbleDock } from "./BubbleDock";
import {
  getBubbleColors,
  getBubbleIcon,
  PHYSICS,
  VISUALS,
} from "./bubble-styles";

// ═══════════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════════

export interface BubbleCanvasProps {
  bubbles: BubbleSchema[];
  /** Called when a bubble is clicked (before opening window) */
  onBubbleClick?: (bubble: BubbleSchema) => void;
  /** Called when a bubble is dragged to a new position */
  onBubbleDrag?: (id: string, x: number, y: number) => void;
  /** Canvas container className */
  className?: string;
  /** Whether the canvas fills its container (default: true) */
  fillContainer?: boolean;
  /** Trusted action callbacks; unsupported actions remain inert. */
  onAction?: (actionId: string, schema: BubbleSchema) => void;
  onSubmit?: (data: Record<string, unknown>, schema: BubbleSchema) => void | Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════════

export const BubbleCanvas: React.FC<BubbleCanvasProps> = ({
  bubbles,
  onBubbleClick,
  onBubbleDrag,
  onAction,
  onSubmit,
  className = "",
  fillContainer = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());
  const [openWindowIds, setOpenWindowIds] = useState<Set<string>>(new Set());
  const clickStartRef = useRef<{ x: number; y: number; time: number; id: string | null }>({
    x: 0,
    y: 0,
    time: 0,
    id: null,
  });
  const dragMovedRef = useRef(false);

  const { openWindow, closeWindow, minimizeWindow, restoreWindow } = useWindowContext();

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDims({ width: rect.width, height: rect.height });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Physics hook
  const {
    physics,
    startDrag,
    updateDrag,
    endDrag,
    setHover,
    draggingId,
    hoveringId,
    impulse,
  } = useBubblePhysics(bubbles, {
    width: dims.width,
    height: dims.height,
    enableMouseRepel: true,
    enableCollisions: true,
    enableFloating: true,
  });

  // Filter out minimized from canvas + dead bubbles
  const visiblePhysics = useMemo(
    () =>
      physics.filter(
        (p) => p.opacity > 0 && !minimizedIds.has(p.id) && !openWindowIds.has(p.id)
      ),
    [physics, minimizedIds, openWindowIds]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Canvas Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = dims.width;
    const h = dims.height;

    // Resize canvas to match device pixel ratio
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // ── Connection lines between nearby bubbles ──
    ctx.save();
    for (let i = 0; i < visiblePhysics.length; i++) {
      const a = visiblePhysics[i];
      for (let j = i + 1; j < visiblePhysics.length; j++) {
        const b = visiblePhysics[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < VISUALS.connectionDistance) {
          const t = 1 - dist / VISUALS.connectionDistance;
          const alpha = t * VISUALS.connectionOpacity * Math.min(a.opacity, b.opacity);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 6]);
          ctx.lineDashOffset = -(Date.now() * 0.02) % 20;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();

    // ── Draw each bubble ──
    for (const p of visiblePhysics) {
      drawBubble(ctx, p, p.id === hoveringId, p.id === draggingId);
    }
  }, [visiblePhysics, dims, hoveringId, draggingId]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      renderCanvas();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [renderCanvas]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Pointer Events (Canvas)
  // ═══════════════════════════════════════════════════════════════════════════

  const getPointerPos = useCallback(
    (e: React.PointerEvent | React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const findBubbleAt = useCallback(
    (x: number, y: number) => {
      // Check in reverse z-order (top-most first)
      for (let i = visiblePhysics.length - 1; i >= 0; i--) {
        const p = visiblePhysics[i];
        const dx = x - p.x;
        const dy = y - p.y;
        if (dx * dx + dy * dy <= p.radius * p.radius) {
          return p;
        }
      }
      return null;
    },
    [visiblePhysics]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return; // Only left click
      const { x, y } = getPointerPos(e);
      const p = findBubbleAt(x, y);

      clickStartRef.current = { x, y, time: Date.now(), id: p?.id ?? null };
      dragMovedRef.current = false;

      if (p) {
        startDrag(p.id, x, y);
      }
    },
    [getPointerPos, findBubbleAt, startDrag]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = getPointerPos(e);
      updateDrag(x, y);

      // Detect drag movement
      const clickStart = clickStartRef.current;
      if (clickStart.id) {
        const dist = Math.hypot(x - clickStart.x, y - clickStart.y);
        if (dist > 4) dragMovedRef.current = true;
      }

      // Hover detection
      const p = findBubbleAt(x, y);
      setHover(p?.id ?? null);
    },
    [getPointerPos, updateDrag, findBubbleAt, setHover]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = getPointerPos(e);
      endDrag();

      const clickStart = clickStartRef.current;
      const duration = Date.now() - clickStart.time;
      const dist = Math.hypot(x - clickStart.x, y - clickStart.y);

      // It's a click if: short duration, small movement, same bubble
      if (
        clickStart.id &&
        duration < 300 &&
        dist < 8 &&
        !dragMovedRef.current
      ) {
        const schema = bubbles.find((b) => b.id === clickStart.id);
        if (schema) {
          handleBubbleOpen(schema);
        }
      } else if (clickStart.id && dragMovedRef.current) {
        onBubbleDrag?.(clickStart.id, x, y);
      }

      clickStartRef.current = { x: 0, y: 0, time: 0, id: null };
    },
    [getPointerPos, endDrag, bubbles, onBubbleDrag]
  );

  // Touch support (synthetic)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const { x, y } = getPointerPos(t as unknown as React.PointerEvent);
        const p = findBubbleAt(x, y);
        if (p) startDrag(p.id, x, y);
      }
    },
    [getPointerPos, findBubbleAt, startDrag]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const { x, y } = getPointerPos(t as unknown as React.PointerEvent);
        updateDrag(x, y);
      }
    },
    [getPointerPos, updateDrag]
  );

  const handleTouchEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Bubble Actions
  // ═══════════════════════════════════════════════════════════════════════════

  const handleBubbleOpen = useCallback(
    (schema: BubbleSchema) => {
      onBubbleClick?.(schema);

      // If already open, just activate
      if (openWindowIds.has(schema.id)) return;

      // Determine window size from schema layout
      const w = typeof schema.layout?.width === "number"
        ? schema.layout.width
        : 460;
      const h = typeof schema.layout?.height === "number"
        ? schema.layout.height
        : 580;

      const content = (
        <SchemaRenderer
          schema={schema}
          onAction={(actionId, schemaRef) => onAction?.(actionId, schemaRef)}
          onSubmit={(data, schemaRef) => onSubmit?.(data, schemaRef)}
        />
      );

      // Center window with random offset if multiple
      const offsetX = (openWindowIds.size % 4) * 30;
      const offsetY = (openWindowIds.size % 4) * 20;
      const cx = Math.max(20, Math.min(dims.width - w - 20, (dims.width - w) / 2 + offsetX));
      const cy = Math.max(20, Math.min(dims.height - h - 20, (dims.height - h) / 3 + offsetY));

      openWindow(schema.title, content, {
        x: cx,
        y: cy,
        width: Math.min(w, dims.width - 40),
        height: Math.min(h, dims.height - 60),
      });

      setOpenWindowIds((prev) => new Set(prev).add(schema.id));
    },
    [onBubbleClick, openWindow, openWindowIds, dims]
  );

  const handleMinimize = useCallback((id: string) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Also remove from open windows
    setOpenWindowIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleRestore = useCallback(
    (id: string) => {
      setMinimizedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Re-open the window
      const schema = bubbles.find((b) => b.id === id);
      if (schema) {
        handleBubbleOpen(schema);
      }
    },
    [bubbles, handleBubbleOpen]
  );

  const handleCloseFromDock = useCallback((id: string) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setOpenWindowIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Build minimized bubble list for dock
  const minimizedBubbles = useMemo(
    () =>
      Array.from(minimizedIds)
        .map((id) => bubbles.find((b) => b.id === id))
        .filter(Boolean)
        .map((schema) => ({ id: schema!.id, schema: schema! })),
    [minimizedIds, bubbles]
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: fillContainer ? "absolute" : "relative",
        inset: fillContainer ? 0 : undefined,
        width: fillContainer ? undefined : dims.width,
        height: fillContainer ? undefined : dims.height,
        overflow: "hidden",
        cursor: hoveringId && !draggingId ? "pointer" : "default",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Minimized dock */}
      <BubbleDock
        bubbles={minimizedBubbles}
        onRestore={handleRestore}
        onClose={handleCloseFromDock}
      />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Canvas Drawing Helper
// ═══════════════════════════════════════════════════════════════════════════════

function drawBubble(
  ctx: CanvasRenderingContext2D,
  p: {
    x: number;
    y: number;
    radius: number;
    opacity: number;
    pulsePhase: number;
    importance: number;
    colors: ReturnType<typeof getBubbleColors>;
    isDragging: boolean;
    isHovering: boolean;
    isSleeping: boolean;
    schema: BubbleSchema;
  },
  isHovered: boolean,
  isDragging: boolean
) {
  const { x, y, radius, opacity, pulsePhase, colors } = p;
  if (opacity <= 0.01) return;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Pulse scale
  const pulseScale = 1 + Math.sin(pulsePhase) * VISUALS.pulseRange;
  const hoverScale = isHovered && !isDragging ? 1.08 : 1;
  const scale = pulseScale * hoverScale;

  // ── Outer glow ──
  const glowRadius = radius * scale + (isHovered ? 18 : 10);
  const glowGrad = ctx.createRadialGradient(x, y, radius * scale * 0.6, x, y, glowRadius);
  glowGrad.addColorStop(0, `${colors.glow}${isHovered ? "30" : "18"}`);
  glowGrad.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // ── Main bubble body (glassmorphism gradient) ──
  const bodyGrad = ctx.createRadialGradient(
    x - radius * 0.2,
    y - radius * 0.3,
    radius * 0.1,
    x,
    y,
    radius * scale
  );
  bodyGrad.addColorStop(0, colors.bgStart);
  bodyGrad.addColorStop(1, colors.bgEnd);

  ctx.beginPath();
  ctx.arc(x, y, radius * scale, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // ── Glass highlight (top-left reflection) ──
  const hlGrad = ctx.createRadialGradient(
    x - radius * 0.25,
    y - radius * 0.3,
    0,
    x - radius * 0.25,
    y - radius * 0.3,
    radius * 0.5
  );
  hlGrad.addColorStop(0, "rgba(255,255,255,0.15)");
  hlGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.ellipse(
    x - radius * 0.15,
    y - radius * 0.25,
    radius * 0.35 * scale,
    radius * 0.18 * scale,
    -0.4,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = hlGrad;
  ctx.fill();

  // ── Border ring ──
  ctx.beginPath();
  ctx.arc(x, y, radius * scale, 0, Math.PI * 2);
  ctx.strokeStyle = `${colors.glow}${isHovered ? "88" : "55"}`;
  ctx.lineWidth = isHovered ? 2.5 : 1.5;
  ctx.stroke();

  // ── Inner glow (canvas shadowBlur) ──
  ctx.save();
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = isHovered ? VISUALS.glowBlur + 8 : VISUALS.glowBlur;
  ctx.beginPath();
  ctx.arc(x, y, radius * scale * 0.9, 0, Math.PI * 2);
  ctx.strokeStyle = "transparent";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // ── Icon text ──
  const icon = getBubbleIcon(p.schema.type);
  ctx.font = `${Math.round(Math.max(16, radius * 0.55 * scale))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colors.text;
  ctx.fillText(icon, x, y);

  // ── Verified dot ──
  if (p.schema.trust.verified) {
    const dotR = Math.max(5, radius * 0.12);
    const dotX = x + radius * scale * 0.65;
    const dotY = y + radius * scale * 0.6;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = "#22c55e";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Glow on dot
    ctx.save();
    ctx.shadowColor = "#22c55e";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = "#22c55e";
    ctx.fill();
    ctx.restore();
  }

  // ── Title label (shown on hover) ──
  if (isHovered) {
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = colors.text;
    const labelY = y + radius * scale + 18;
    // Text shadow
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(p.schema.title, x, labelY);
    ctx.restore();

    // Type badge above
    ctx.font = "500 10px sans-serif";
    ctx.fillStyle = colors.textMuted;
    const typeY = y - radius * scale - 10;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.fillText(p.schema.type.toUpperCase(), x, typeY);
    ctx.restore();
  }

  ctx.restore();
}
