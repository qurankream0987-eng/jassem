import { useEffect, useRef, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BubbleData {
  id: string;
  x: number; // center x (0-1 normalized)
  y: number; // center y (0-1 normalized)
  radius: number; // px
  label: string;
  icon: string; // emoji or character
  color: string; // hex color
  wobblePhase: number;
  opacity: number;
  floatAnim?: string;
  floatDuration?: number;
  floatIndex?: number;
}

export interface PopParticle {
  id: number;
  x: number;
  y: number;
  tx: number; // target x offset
  ty: number; // target y offset
  color: string;
  size: number;
  bornAt: number; // timestamp
  lifeMs: number; // total lifetime in ms
}

interface BubbleCanvasProps {
  bubbles: BubbleData[];
  popParticles: PopParticle[];
  onBubbleClick?: (id: string) => void;
  onBubbleLongPress?: (id: string, x: number, y: number) => void;
  longPressThreshold?: number;
}

// ─── Helper: hex → rgba ──────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Soap Bubble Drawing ─────────────────────────────────────────────────────

function drawSoapBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  time: number,
  wobblePhase: number,
  opacity: number
): void {
  // Apply wobble to radius
  const wobble = Math.sin(time * 0.003 + wobblePhase) * 1.5;
  const r = Math.max(2, radius + wobble);

  ctx.save();
  ctx.globalAlpha = opacity;

  // 1. Subtle Glow behind bubble
  const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.2);
  glowGrad.addColorStop(0, hexToRgba(color, 0.08));
  glowGrad.addColorStop(0.5, hexToRgba(color, 0.03));
  glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // 2. Main bubble body — semi-transparent fill
  const bodyGrad = ctx.createRadialGradient(
    cx - r * 0.25,
    cy - r * 0.25,
    r * 0.05,
    cx,
    cy,
    r
  );
  bodyGrad.addColorStop(0, 'rgba(255,255,255,0.06)');
  bodyGrad.addColorStop(0.6, hexToRgba(color, 0.08));
  bodyGrad.addColorStop(1, hexToRgba(color, 0.15));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // 3. Fresnel Rim — white edge highlight using arc stroke with gradient alpha
  const rimGrad = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r);
  rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
  rimGrad.addColorStop(0.7, hexToRgba(color, 0.25));
  rimGrad.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 4. Chromatic Aberration — slight RGB color separation at edges
  // Cyan shifted left
  ctx.globalCompositeOperation = 'screen';
  ctx.beginPath();
  ctx.arc(cx - 1.2, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.12)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Magenta shifted right
  ctx.beginPath();
  ctx.arc(cx + 1.2, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.10)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  // 5. Caustic Highlight — bright curved highlight inside bubble (upper-left)
  const hlAngle = -Math.PI * 0.75;
  const hlX = cx + Math.cos(hlAngle) * r * 0.42;
  const hlY = cy + Math.sin(hlAngle) * r * 0.42;
  const hlGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, r * 0.35);
  hlGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
  hlGrad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(hlX, hlY, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = hlGrad;
  ctx.fill();

  // Curved caustic arc (upper-left)
  ctx.beginPath();
  ctx.arc(
    cx - r * 0.1,
    cy - r * 0.1,
    r * 0.78,
    -Math.PI * 0.6,
    -Math.PI * 0.15
  );
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 6. Specular Sheen — small bright dot reflection
  const specX = cx + Math.cos(hlAngle + 0.3) * r * 0.32;
  const specY = cy + Math.sin(hlAngle + 0.3) * r * 0.32;
  ctx.beginPath();
  ctx.arc(specX, specY, Math.max(1, r * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();

  // 7. Secondary Caustic — fainter highlight opposite side (lower-right)
  const secAngle = Math.PI * 0.3;
  const secX = cx + Math.cos(secAngle) * r * 0.55;
  const secY = cy + Math.sin(secAngle) * r * 0.55;
  const secGrad = ctx.createRadialGradient(secX, secY, 0, secX, secY, r * 0.2);
  secGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
  secGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(secX, secY, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = secGrad;
  ctx.fill();

  ctx.restore();
}

// ─── Draw Label ──────────────────────────────────────────────────────────────

function drawBubbleLabel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  label: string,
  icon: string,
  opacity: number
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Icon
  const iconSize = Math.max(14, radius * 0.38);
  ctx.font = `${iconSize}px 'Noto Sans Arabic', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(icon, cx, cy - radius * 0.05);

  // Label below bubble
  const labelSize = Math.max(9, radius * 0.2);
  ctx.font = `600 ${labelSize}px 'Noto Sans Arabic', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillText(label, cx, cy + radius + labelSize + 4);
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ─── Draw Pop Particles ──────────────────────────────────────────────────────

function drawPopParticles(
  ctx: CanvasRenderingContext2D,
  particles: PopParticle[],
  time: number
): void {
  particles.forEach((p) => {
    const elapsed = time - p.bornAt;
    if (elapsed < 0 || elapsed > p.lifeMs) return;

    const progress = elapsed / p.lifeMs;
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const curX = p.x + p.tx * easeOut;
    const curY = p.y + p.ty * easeOut;
    const scale = 1 - progress;
    const alpha = 1 - progress;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Glow
    ctx.beginPath();
    ctx.arc(curX, curY, p.size * scale * 2, 0, Math.PI * 2);
    const glowGrad = ctx.createRadialGradient(curX, curY, 0, curX, curY, p.size * scale * 2);
    glowGrad.addColorStop(0, hexToRgba(p.color, 0.5));
    glowGrad.addColorStop(1, hexToRgba(p.color, 0));
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(curX, curY, p.size * scale, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(p.color, 1);
    ctx.fill();

    ctx.restore();
  });
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function BubbleCanvas({
  bubbles,
  popParticles,
  onBubbleClick,
  onBubbleLongPress,
  longPressThreshold = 400,
}: BubbleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  // Pointer tracking for interaction
  const pointerDownRef = useRef<{
    bubbleId: string;
    startX: number;
    startY: number;
    startTime: number;
    timerId: ReturnType<typeof setTimeout>;
    triggered: boolean;
  } | null>(null);

  // Resolve which bubble (if any) is at the given canvas coords
  const hitTest = useCallback(
    (canvasX: number, canvasY: number, canvasW: number, canvasH: number): BubbleData | null => {
      // Check in reverse order (top-most first)
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const bx = b.x * canvasW;
        const by = b.y * canvasH;
        const dx = canvasX - bx;
        const dy = canvasY - by;
        // Include some padding for easier hitting
        const hitR = b.radius + 8;
        if (dx * dx + dy * dy <= hitR * hitR) {
          return b;
        }
      }
      return null;
    },
    [bubbles]
  );

  // ── Pointer Handlers ──
  const getCanvasCoords = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0, w: 0, h: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
        w: canvas.width,
        h: canvas.height,
        clientX: e.clientX,
        clientY: e.clientY,
      };
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const { x, y, w, h, clientX, clientY } = getCanvasCoords(e);
      const hit = hitTest(x, y, w, h);
      if (!hit) return;

      // Cancel any existing pointer down
      if (pointerDownRef.current) {
        clearTimeout(pointerDownRef.current.timerId);
      }

      const timerId = setTimeout(() => {
        // Long press triggered
        if (pointerDownRef.current && !pointerDownRef.current.triggered) {
          pointerDownRef.current.triggered = true;
          onBubbleLongPress?.(hit.id, clientX, clientY);
        }
      }, longPressThreshold);

      pointerDownRef.current = {
        bubbleId: hit.id,
        startX: clientX,
        startY: clientY,
        startTime: Date.now(),
        timerId,
        triggered: false,
      };
    },
    [getCanvasCoords, hitTest, onBubbleLongPress, longPressThreshold]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerDownRef.current) return;

      const pd = pointerDownRef.current;
      clearTimeout(pd.timerId);

      if (!pd.triggered) {
        const elapsed = Date.now() - pd.startTime;
        if (elapsed < longPressThreshold) {
          onBubbleClick?.(pd.bubbleId);
        }
      }

      pointerDownRef.current = null;
    },
    [onBubbleClick, longPressThreshold]
  );

  const handlePointerLeave = useCallback(() => {
    if (pointerDownRef.current) {
      clearTimeout(pointerDownRef.current.timerId);
      pointerDownRef.current = null;
    }
  }, []);

  // ── Render Loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      timeRef.current = time;
      ctx.clearRect(0, 0, w, h);

      // Draw bubbles
      bubbles.forEach((bubble) => {
        const bx = bubble.x * w;
        const by = bubble.y * h;

        drawSoapBubble(
          ctx,
          bx,
          by,
          bubble.radius,
          bubble.color,
          time,
          bubble.wobblePhase,
          bubble.opacity
        );

        drawBubbleLabel(
          ctx,
          bx,
          by,
          bubble.radius,
          bubble.label,
          bubble.icon,
          bubble.opacity
        );
      });

      // Draw pop particles
      if (popParticles.length > 0) {
        drawPopParticles(ctx, popParticles, time);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [bubbles, popParticles]);

  return (
    <>
      {/* Canvas layer — pointer-events: none */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 15,
          pointerEvents: 'none',
        }}
      />
      {/* Overlay div for pointer events */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 16,
          pointerEvents: 'auto',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </>
  );
}
