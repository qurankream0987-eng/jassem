/**
 * useBubblePhysics.ts
 * React hook that drives the full physics simulation for JASIM bubbles.
 * Uses requestAnimationFrame for smooth 60fps updates.
 *
 * Physics model:
 *   • Gentle sine-wave floating (upward drift)
 *   • Soft spring collision between bubbles
 *   • Mouse/touch repulsion
 *   • Edge bounce with damping
 *   • Light gravity (negative = float up)
 *   • Velocity friction
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type { BubbleSchema } from "@contracts/jasim";
import {
  getBubbleColors,
  getBubbleRadius,
  PHYSICS,
} from "./bubble-styles";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface BubblePhysics {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Importance 0-1 used for sizing & visual weight */
  importance: number;
  /** Base color palette */
  colors: ReturnType<typeof getBubbleColors>;
  /** Phase offset for sine wave (prevents sync) */
  floatPhase: number;
  /** Current pulse phase */
  pulsePhase: number;
  /** 0-1 opacity */
  opacity: number;
  /** Whether this bubble is being dragged */
  isDragging: boolean;
  /** Whether mouse is hovering */
  isHovering: boolean;
  /** Whether bubble is sleeping (very low velocity) */
  isSleeping: boolean;
  /** Target opacity for smooth fade */
  targetOpacity: number;
  /** Schema reference */
  schema: BubbleSchema;
}

export interface PhysicsConfig {
  width: number;
  height: number;
  /** Enable/disable mouse repulsion */
  enableMouseRepel?: boolean;
  /** Enable/disable soft collisions */
  enableCollisions?: boolean;
  /** Enable/disable floating motion */
  enableFloating?: boolean;
}

export interface PhysicsOutput {
  /** Current physics state for every bubble */
  physics: BubblePhysics[];
  /** Start dragging a bubble */
  startDrag: (id: string, x: number, y: number) => void;
  /** Update drag position */
  updateDrag: (x: number, y: number) => void;
  /** End dragging */
  endDrag: () => void;
  /** Set hover state */
  setHover: (id: string | null) => void;
  /** Currently dragging bubble id */
  draggingId: string | null;
  /** Currently hovering bubble id */
  hoveringId: string | null;
  /** Impulse a bubble (e.g. on spawn) */
  impulse: (id: string, dx: number, dy: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Generate a deterministic float phase from id string */
function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h << 5) - h + id.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 1000;
}

/** Importance from schema metadata or default 0.5 */
function getImportance(schema: BubbleSchema): number {
  const meta = schema.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.importance === "number") {
    return clamp(meta.importance, 0, 1);
  }
  // Derive from trust level
  if (schema.trust.level === "system") return 1.0;
  if (schema.trust.level === "trusted") return 0.85;
  if (schema.trust.level === "verified") return 0.7;
  if (schema.trust.level === "basic") return 0.5;
  return 0.4;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════════

export function useBubblePhysics(
  bubbles: BubbleSchema[],
  config: PhysicsConfig
): PhysicsOutput {
  const { width, height } = config;
  const enableMouseRepel = config.enableMouseRepel ?? true;
  const enableCollisions = config.enableCollisions ?? true;
  const enableFloating = config.enableFloating ?? true;

  const physicsRef = useRef<BubblePhysics[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveringId, setHoveringId] = useState<string | null>(null);

  // Initialise / reconcile physics state when bubbles change
  useEffect(() => {
    const existing = physicsRef.current;
    const newPhysics: BubblePhysics[] = [];

    for (const schema of bubbles) {
      const prev = existing.find((p) => p.id === schema.id);
      if (prev) {
        // Keep existing physics, just update schema ref
        prev.schema = schema;
        prev.importance = getImportance(schema);
        prev.radius = getBubbleRadius(prev.importance);
        prev.colors = getBubbleColors(schema.type);
        prev.targetOpacity = 1;
        newPhysics.push(prev);
      } else {
        // Spawn new bubble — random position near bottom-center with upward velocity
        const importance = getImportance(schema);
        const radius = getBubbleRadius(importance);
        const phase = hashPhase(schema.id);
        const spawnX = width / 2 + (Math.random() - 0.5) * (width * 0.5);
        const spawnY = height - radius - 20 - Math.random() * 100;

        newPhysics.push({
          id: schema.id,
          x: clamp(spawnX, radius + 10, width - radius - 10),
          y: clamp(spawnY, radius + 10, height - radius - 10),
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 1.2 - 0.5,
          radius,
          importance,
          colors: getBubbleColors(schema.type),
          floatPhase: phase,
          pulsePhase: Math.random() * Math.PI * 2,
          opacity: 0,
          isDragging: false,
          isHovering: false,
          isSleeping: false,
          targetOpacity: 1,
          schema,
        });
      }
    }

    // Fade out removed bubbles (they'll be cleaned up next render)
    for (const p of existing) {
      if (!bubbles.find((b) => b.id === p.id)) {
        p.targetOpacity = 0;
        newPhysics.push(p);
      }
    }

    physicsRef.current = newPhysics;
  }, [bubbles, width, height]);

  // Track mouse position globally
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        mouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  // Physics update loop
  useEffect(() => {
    let running = true;

    const step = (time: number) => {
      if (!running) return;
      const dt = lastTimeRef.current ? Math.min(time - lastTimeRef.current, 32) : 16;
      lastTimeRef.current = time;

      const list = physicsRef.current;
      const mouse = mouseRef.current;
      const dragging = draggingRef.current;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];

        // ── Fade in/out ──
        const fadeSpeed = 0.04;
        if (p.opacity < p.targetOpacity) {
          p.opacity = Math.min(1, p.opacity + fadeSpeed);
        } else if (p.opacity > p.targetOpacity) {
          p.opacity = Math.max(0, p.opacity - fadeSpeed);
        }
        if (p.opacity <= 0 && p.targetOpacity === 0) continue; // Dead bubble

        // ── Dragging overrides physics ──
        if (dragging && dragging.id === p.id) {
          p.vx = 0;
          p.vy = 0;
          p.isSleeping = false;
          continue;
        }

        // ── Floating sine wave (gentle ambient motion) ──
        if (enableFloating && !p.isSleeping) {
          const floatX =
            Math.sin(time * PHYSICS.floatFrequency + p.floatPhase) *
            PHYSICS.floatAmplitude;
          const floatY =
            Math.cos(time * PHYSICS.floatFrequency * 0.7 + p.floatPhase) *
            PHYSICS.floatAmplitude *
            0.5;
          p.vx += floatX * 0.01;
          p.vy += floatY * 0.01;
        }

        // ── Gravity (light upward drift) ──
        if (!p.isSleeping) {
          p.vy += PHYSICS.gravity;
        }

        // ── Mouse repulsion ──
        if (enableMouseRepel && mouse.x > -1000) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < PHYSICS.mouseRepelRadius && dist > 0.1) {
            const force =
              ((PHYSICS.mouseRepelRadius - dist) / PHYSICS.mouseRepelRadius) *
              PHYSICS.mouseRepelForce;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        // ── Soft collision (spring repulsion) ──
        if (enableCollisions) {
          for (let j = i + 1; j < list.length; j++) {
            const other = list[j];
            if (other.opacity <= 0) continue;
            const dx = p.x - other.x;
            const dy = p.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = p.radius + other.radius + 4; // 4px gap
            if (dist < minDist && dist > 0.1) {
              const overlap = minDist - dist;
              const nx = dx / dist;
              const ny = dy / dist;
              const force = overlap * PHYSICS.springK;
              p.vx += nx * force;
              p.vy += ny * force;
              other.vx -= nx * force;
              other.vy -= ny * force;
            }
          }
        }

        // ── Edge bounce ──
        const margin = p.radius;
        if (p.x < margin) {
          p.x = margin;
          p.vx = Math.abs(p.vx) * PHYSICS.bounceDamp;
        } else if (p.x > width - margin) {
          p.x = width - margin;
          p.vx = -Math.abs(p.vx) * PHYSICS.bounceDamp;
        }
        if (p.y < margin) {
          p.y = margin;
          p.vy = Math.abs(p.vy) * PHYSICS.bounceDamp;
        } else if (p.y > height - margin) {
          p.y = height - margin;
          p.vy = -Math.abs(p.vy) * PHYSICS.bounceDamp;
        }

        // ── Velocity cap ──
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > PHYSICS.maxVelocity) {
          p.vx = (p.vx / speed) * PHYSICS.maxVelocity;
          p.vy = (p.vy / speed) * PHYSICS.maxVelocity;
        }

        // ── Friction / damping ──
        p.vx *= PHYSICS.friction;
        p.vy *= PHYSICS.friction;

        // ── Sleep detection ──
        if (speed < PHYSICS.sleepThreshold) {
          p.isSleeping = true;
        } else {
          p.isSleeping = false;
        }

        // ── Apply velocity ──
        p.x += p.vx;
        p.y += p.vy;

        // ── Update pulse ──
        p.pulsePhase += PHYSICS.floatFrequency * dt * 2;
      }

      animFrameRef.current = requestAnimationFrame(step);
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [width, height, enableMouseRepel, enableCollisions, enableFloating]);

  // ── Interaction API ──

  const startDrag = useCallback((id: string, x: number, y: number) => {
    const p = physicsRef.current.find((b) => b.id === id);
    if (!p) return;
    draggingRef.current = {
      id,
      offsetX: x - p.x,
      offsetY: y - p.y,
    };
    p.isDragging = true;
    p.vx = 0;
    p.vy = 0;
    setDraggingId(id);
  }, []);

  const updateDrag = useCallback(
    (x: number, y: number) => {
      const d = draggingRef.current;
      if (!d) return;
      const p = physicsRef.current.find((b) => b.id === d.id);
      if (!p) return;
      p.x = clamp(x - d.offsetX, p.radius + 2, width - p.radius - 2);
      p.y = clamp(y - d.offsetY, p.radius + 2, height - p.radius - 2);
    },
    [width, height]
  );

  const endDrag = useCallback(() => {
    const d = draggingRef.current;
    if (d) {
      const p = physicsRef.current.find((b) => b.id === d.id);
      if (p) {
        p.isDragging = false;
        // Give a small random drift on release so it doesn't feel dead
        p.vx = (Math.random() - 0.5) * 0.6;
        p.vy = (Math.random() - 0.5) * 0.6 - 0.3;
      }
    }
    draggingRef.current = null;
    setDraggingId(null);
  }, []);

  const setHover = useCallback((id: string | null) => {
    for (const p of physicsRef.current) {
      p.isHovering = p.id === id;
    }
    setHoveringId(id);
  }, []);

  const impulse = useCallback((id: string, dx: number, dy: number) => {
    const p = physicsRef.current.find((b) => b.id === id);
    if (p) {
      p.vx += dx;
      p.vy += dy;
      p.isSleeping = false;
    }
  }, []);

  // Return a snapshot copy for React renders
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      setRenderTick((t) => t + 1);
      requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // Build fresh array every render so downstream components see updates
  const physicsSnapshot = physicsRef.current.map((p) => ({ ...p }));

  return {
    physics: physicsSnapshot,
    startDrag,
    updateDrag,
    endDrag,
    setHover,
    draggingId,
    hoveringId,
    impulse,
  };
}
