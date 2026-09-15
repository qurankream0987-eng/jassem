import { useRef, useEffect, useCallback } from 'react';

export interface BubbleData {
  id: string; label: string; x: number; y: number; r: number;
  color: string; color2: string; desc: string;
  items: { title: string; val: string; up: boolean }[];
}
interface BubbleCanvasProps {
  bubbles: BubbleData[];
  onBubbleClick?: (bubble: BubbleData, screenX: number, screenY: number) => void;
  onBubblePop?: (x: number, y: number, color: string) => void;
}
interface BState {
  data: BubbleData; px: number; py: number; pr: number;
  vx: number; vy: number; dragVx: number; dragVy: number;
  popped: boolean; popTimer: number; hover: boolean;
}
interface DragSt {
  active: boolean; bubble: BState | null;
  startX: number; startY: number; lastX: number; lastY: number;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  longPressTriggered: boolean; moved: boolean;
}

function hexRgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const b = parseInt(h, 16);
  return `rgba(${(b >> 16) & 255},${(b >> 8) & 255},${b & 255},${a})`;
}
function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const b = parseInt(h, 16);
  return { r: (b >> 16) & 255, g: (b >> 8) & 255, b: b & 255 };
}
function getAt(mx: number, my: number, bs: BState[]) {
  for (let i = bs.length - 1; i >= 0; i--) {
    const b = bs[i];
    if (b.popped) continue;
    const dx = mx - b.px, dy = my - b.py;
    if (dx * dx + dy * dy < (b.pr + 10) * (b.pr + 10)) return b;
  }
  return null;
}
function popParts(x: number, y: number, color: string) {
  for (let i = 0; i < 12; i++) {
    const s = 2 + Math.random() * 6;
    const a = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
    const sp = 40 + Math.random() * 100;
    const tx = Math.cos(a) * sp, ty = Math.sin(a) * sp;
    const d = 0.5 + Math.random() * 0.4;
    const p = document.createElement('div');
    p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(circle,${color},transparent);pointer-events:none;z-index:999;--tx:${tx}px;--ty:${ty}px;animation:popFly ${d}s ease-out forwards;`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), d * 1000 + 50);
  }
}

// ===== BUBBLE CONTENT - drawn BEFORE the film (visible through bubble) =====
function drawBubbleContent(b: BState, ctx: CanvasRenderingContext2D, t: number) {
  const { px, py, pr, data } = b;
  const id = data.id;
  ctx.save();
  ctx.translate(px, py);

  // Clip to bubble circle (slightly smaller than radius for margin)
  ctx.beginPath();
  ctx.arc(0, 0, pr * 0.65, 0, Math.PI * 2);
  ctx.clip();

  // Slight tint background inside
  ctx.fillStyle = hexRgba(data.color, 0.04);
  ctx.fillRect(-pr, -pr, pr * 2, pr * 2);

  const c = hexToRgb(data.color);
  const c2 = hexToRgb(data.color2);

  switch (id) {
    case 'ads': {
      // Bar chart
      for (let i = 0; i < 4; i++) {
        const h = pr * 0.12 + Math.sin(t * 2 + i * 1.3) * pr * 0.1;
        const bw = pr * 0.1;
        const bx = -pr * 0.2 + i * pr * 0.14;
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.3)`;
        ctx.fillRect(bx, pr * 0.15 - h, bw, h);
      }
      // Line chart overlay
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const lx = -pr * 0.22 + i * pr * 0.12;
        const ly = -pr * 0.1 + Math.sin(t * 1.5 + i * 0.8) * pr * 0.08;
        if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
      }
      ctx.strokeStyle = `rgba(${c2.r},${c2.g},${c2.b},0.4)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case 'suggest': {
      // Sparkle / star shapes orbiting
      for (let i = 0; i < 3; i++) {
        const angle = t * 0.8 + i * (Math.PI * 2 / 3);
        const sx = Math.cos(angle) * pr * 0.2;
        const sy = Math.sin(angle) * pr * 0.15;
        drawStar(ctx, sx, sy, 4, pr * 0.06, pr * 0.03, `rgba(${c2.r},${c2.g},${c2.b},0.4)`);
      }
      // Central glow dot
      ctx.beginPath();
      ctx.arc(0, 0, pr * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.3)`;
      ctx.fill();
      break;
    }
    case 'subchat': {
      // Small chat bubbles
      ctx.save();
      const bob = Math.sin(t * 1.2) * 2;
      // Left chat bubble
      roundRect(ctx, -pr * 0.22, -pr * 0.15 + bob, pr * 0.2, pr * 0.14, pr * 0.03);
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.25)`;
      ctx.fill();
      // Right chat bubble
      roundRect(ctx, -pr * 0.08, -pr * 0.05 - bob, pr * 0.2, pr * 0.14, pr * 0.03);
      ctx.fillStyle = `rgba(${c2.r},${c2.g},${c2.b},0.25)`;
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'wallet': {
      // Wallet shape + coin
      const wobble = Math.sin(t) * 3;
      // Wallet body
      roundRect(ctx, -pr * 0.2, -pr * 0.1, pr * 0.4, pr * 0.22, pr * 0.04);
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.25)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${c2.r},${c2.g},${c2.b},0.35)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Coin orbiting
      const cx = Math.cos(t * 0.7 + wobble * 0.1) * pr * 0.12;
      const cy = Math.sin(t * 0.7 + wobble * 0.1) * pr * 0.1 - pr * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, pr * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c2.r},${c2.g},${c2.b},0.4)`;
      ctx.fill();
      // $ on coin
      ctx.fillStyle = `rgba(${c2.r},${c2.g},${c2.b},0.6)`;
      ctx.font = `bold ${Math.round(pr * 0.08)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', cx, cy);
      break;
    }
    case 'analytics': {
      // Bar chart with different heights
      const barHeights = [0.35, 0.55, 0.25, 0.7, 0.45];
      for (let i = 0; i < 5; i++) {
        const h = barHeights[i] * pr * 0.35 + Math.sin(t * 1.8 + i * 0.7) * pr * 0.04;
        const bw = pr * 0.07;
        const bx = -pr * 0.2 + i * pr * 0.1;
        ctx.fillStyle = `rgba(${i % 2 === 0 ? c.r : c2.r},${i % 2 === 0 ? c.g : c2.g},${i % 2 === 0 ? c.b : c2.b},0.3)`;
        ctx.fillRect(bx, pr * 0.15 - h, bw, h);
      }
      break;
    }
    case 'settings': {
      // Gear shape
      const teeth = 8;
      const outerR = pr * 0.18;
      const innerR = pr * 0.13;
      const rot = t * 0.3;
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const angle = (i / (teeth * 2)) * Math.PI * 2 + rot;
        const radius = i % 2 === 0 ? outerR : innerR;
        const gx = Math.cos(angle) * radius;
        const gy = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(gx, gy); else ctx.lineTo(gx, gy);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.2)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${c2.r},${c2.g},${c2.b},0.4)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Center hole
      ctx.beginPath();
      ctx.arc(0, 0, pr * 0.05, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c2.r},${c2.g},${c2.b},0.3)`;
      ctx.fill();
      break;
    }
    default: {
      // Default: pulsing orb
      ctx.beginPath();
      ctx.arc(0, 0, pr * 0.15 + Math.sin(t * 2) * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.15)`;
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, points: number, outerR: number, innerR: number, color: string) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const sx = x + Math.cos(angle) * r;
    const sy = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ===== BUBBLE FILM - drawn AFTER content (soap film effect) =====
function drawBubbleFilm(
  b: BState,
  ctx: CanvasRenderingContext2D,
  t: number,
  wobblePhase: number,
) {
  const { px, py, pr, hover } = b;
  const { color, color2, label } = b.data;
  const rgb = hexToRgb(color);
  const rgb2 = hexToRgb(color2);
  let r = hover ? pr * 1.08 : pr;

  // Wobble deformation
  const wobbleAmp = 0.02;
  const wobble1 = Math.sin(wobblePhase * 1.7) * wobbleAmp;
  const wobble2 = Math.cos(wobblePhase * 2.3) * wobbleAmp;

  // ===== 1. SOFT GLOW AROUND BUBBLE =====
  ctx.save();
  ctx.beginPath();
  const glowR = r * 2.5;
  const glowGrad = ctx.createRadialGradient(px, py, r * 0.8, px, py, glowR);
  glowGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`);
  glowGrad.addColorStop(0.3, `rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.06)`);
  glowGrad.addColorStop(0.7, `rgba(${rgb.r},${rgb.g},${rgb.b},0.02)`);
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.arc(px, py, glowR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ===== 2. THIN-FILM INTERFERENCE (iridescent color bands) =====
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // Multiple interference bands that shift with time
  const bandCount = 6;
  for (let i = bandCount; i >= 0; i--) {
    const frac = i / bandCount;
    const shift = Math.sin(t * 0.6 + frac * 3) * 0.15;
    const bandR = r * (0.2 + frac * 0.8 + shift);
    if (bandR <= 0) continue;

    // Interference color cycling
    const hueShift = (t * 0.3 + frac * 2.5 + wobblePhase * 0.1) % 6;
    const alpha = 0.03 + Math.sin(frac * Math.PI) * 0.06;

    let bandColor: string;
    if (hueShift < 1) bandColor = `rgba(0,255,255,${alpha})`;         // Cyan
    else if (hueShift < 2) bandColor = `rgba(100,149,255,${alpha})`;   // Cornflower
    else if (hueShift < 3) bandColor = `rgba(200,100,255,${alpha})`;   // Purple
    else if (hueShift < 4) bandColor = `rgba(255,105,180,${alpha})`;   // Hot pink
    else if (hueShift < 5) bandColor = `rgba(255,165,0,${alpha})`;     // Orange
    else bandColor = `rgba(255,215,0,${alpha})`;                       // Gold

    ctx.beginPath();
    // Apply wobble to path
    for (let a = 0; a <= 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      const wr = bandR * (1 + wobble1 * Math.sin(rad * 3) + wobble2 * Math.cos(rad * 2));
      const bx = px + Math.cos(rad) * wr;
      const by = py + Math.sin(rad) * wr;
      if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
    }
    ctx.closePath();
    ctx.fillStyle = bandColor;
    ctx.fill();
  }
  ctx.restore();

  // ===== 3. BASE TRANSPARENT BODY =====
  ctx.save();
  ctx.beginPath();
  for (let a = 0; a <= 360; a += 5) {
    const rad = (a * Math.PI) / 180;
    const wr = r * (1 + wobble1 * Math.sin(rad * 3) + wobble2 * Math.cos(rad * 2));
    const bx = px + Math.cos(rad) * wr;
    const by = py + Math.sin(rad) * wr;
    if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath();
  const bodyGrad = ctx.createRadialGradient(
    px - r * 0.15, py - r * 0.15, r * 0.05,
    px, py, r,
  );
  bodyGrad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 80)},${Math.min(255, rgb.g + 80)},${Math.min(255, rgb.b + 80)},0.06)`);
  bodyGrad.addColorStop(0.4, `rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.05)`);
  bodyGrad.addColorStop(0.85, `rgba(${rgb.r},${rgb.g},${rgb.b},0.04)`);
  bodyGrad.addColorStop(1, `rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.1)`);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.restore();

  // ===== 4. CHROMATIC ABERRATION at edges =====
  ctx.save();
  // Red channel shifted slightly outward
  ctx.beginPath();
  for (let a = 0; a <= 360; a += 5) {
    const rad = (a * Math.PI) / 180;
    const wr = r * 1.01;
    const bx = px + Math.cos(rad) * wr + 1;
    const by = py + Math.sin(rad) * wr;
    if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,60,60,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cyan channel shifted slightly inward
  ctx.beginPath();
  for (let a = 0; a <= 360; a += 5) {
    const rad = (a * Math.PI) / 180;
    const wr = r * 0.99;
    const bx = px + Math.cos(rad) * wr - 1;
    const by = py + Math.sin(rad) * wr;
    if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(60,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ===== 5. FRESNEL RIM (strong white edge) =====
  ctx.save();
  ctx.beginPath();
  for (let a = 0; a <= 360; a += 3) {
    const rad = (a * Math.PI) / 180;
    const wr = r * (1 + wobble1 * Math.sin(rad * 3) * 0.5);
    const bx = px + Math.cos(rad) * wr;
    const by = py + Math.sin(rad) * wr;
    if (a === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath();
  // Fresnel: stronger at glancing angles (edge), weaker facing camera (center)
  const rimGrad = ctx.createRadialGradient(px, py, r * 0.75, px, py, r);
  rimGrad.addColorStop(0, 'transparent');
  rimGrad.addColorStop(0.7, `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`);
  rimGrad.addColorStop(0.9, `rgba(${Math.min(255, rgb.r + 60)},${Math.min(255, rgb.g + 60)},${Math.min(255, rgb.b + 60)},0.45)`);
  rimGrad.addColorStop(1, 'rgba(255,255,255,0.65)');
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  // ===== 6. PRIMARY CAUSTIC HIGHLIGHT (upper portion - bright curved highlight) =====
  ctx.save();
  const c1x = px - r * 0.25;
  const c1y = py - r * 0.25;
  const c1r = r * 0.5;
  // Caustic shape - crescent-like
  ctx.beginPath();
  ctx.ellipse(c1x, c1y, c1r * 0.7, c1r * 0.45, -0.4, 0, Math.PI * 2);
  const caustic1 = ctx.createRadialGradient(c1x, c1y, 0, c1x, c1y, c1r);
  caustic1.addColorStop(0, 'rgba(255,255,255,0.55)');
  caustic1.addColorStop(0.3, 'rgba(255,255,255,0.2)');
  caustic1.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  caustic1.addColorStop(1, 'transparent');
  ctx.fillStyle = caustic1;
  ctx.fill();
  ctx.restore();

  // ===== 7. SECONDARY CAUSTIC (fainter highlight, lower portion) =====
  ctx.save();
  const c2x = px + r * 0.35;
  const c2y = py + r * 0.3;
  ctx.beginPath();
  ctx.ellipse(c2x, c2y, r * 0.3, r * 0.18, 0.5, 0, Math.PI * 2);
  const caustic2 = ctx.createRadialGradient(c2x, c2y, 0, c2x, c2y, r * 0.35);
  caustic2.addColorStop(0, 'rgba(255,255,255,0.2)');
  caustic2.addColorStop(0.4, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
  caustic2.addColorStop(1, 'transparent');
  ctx.fillStyle = caustic2;
  ctx.fill();
  ctx.restore();

  // ===== 8. TINY BRIGHT SPECULAR DOT (pinpoint reflection) =====
  ctx.save();
  const specX = px - r * 0.3;
  const specY = py - r * 0.35;
  ctx.beginPath();
  ctx.arc(specX, specY, r * 0.08, 0, Math.PI * 2);
  const specGrad = ctx.createRadialGradient(specX, specY, 0, specX, specY, r * 0.08);
  specGrad.addColorStop(0, 'rgba(255,255,255,0.85)');
  specGrad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  specGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = specGrad;
  ctx.fill();
  ctx.restore();

  // ===== 9. LABEL =====
  if (r > 20 && !b.popped) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `bold 13px 'Noto Sans Arabic', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.fillText(label, px, py + r * 0.55);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

export default function BubbleCanvas({ bubbles, onBubbleClick, onBubblePop }: BubbleCanvasProps) {
  const cvsRef = useRef<HTMLCanvasElement>(null);
  const ctrRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<BState[]>([]);
  const dgRef = useRef<DragSt>({
    active: false, bubble: null, startX: 0, startY: 0,
    lastX: 0, lastY: 0, longPressTimer: null,
    longPressTriggered: false, moved: false,
  });
  const tRef = useRef(0);
  const aRef = useRef(0);

  useEffect(() => {
    const ex = stRef.current;
    stRef.current = bubbles.map((d) => {
      const p = ex.find((e) => e.data.id === d.id);
      if (p && !p.popped) return { ...p, data: d, px: d.x, py: d.y };
      return {
        data: d, px: d.x, py: d.y, pr: d.r,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        dragVx: 0, dragVy: 0,
        popped: false, popTimer: 0, hover: false,
      };
    });
  }, [bubbles]);

  const getPos = useCallback((e: MouseEvent | Touch) => {
    const c = cvsRef.current;
    if (!c) return { mx: 0, my: 0, cx: 0, cy: 0 };
    const r = c.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
  }, []);

  const onDn = useCallback((e: MouseEvent | TouchEvent) => {
    const ev = 'touches' in e ? e.touches[0] : e;
    if (!ev) return;
    e.preventDefault();
    const { mx, my, cx, cy } = getPos(ev);
    const b = getAt(mx, my, stRef.current);
    if (!b) return;
    const d = dgRef.current;
    d.active = true;
    d.bubble = b;
    d.startX = cx;
    d.startY = cy;
    d.lastX = cx;
    d.lastY = cy;
    d.longPressTriggered = false;
    d.moved = false;
    d.longPressTimer = setTimeout(() => {
      if (d.active && d.bubble && !d.moved) {
        d.longPressTriggered = true;
        d.active = false;
        const bub = d.bubble;
        bub.popped = true;
        bub.popTimer = 0;
        popParts(cx, cy, bub.data.color);
        onBubblePop?.(cx, cy, bub.data.color);
        d.bubble = null;
      }
    }, 400);
  }, [getPos, onBubblePop]);

  const onMv = useCallback((e: MouseEvent | TouchEvent) => {
    const ev = 'touches' in e ? e.touches[0] : e;
    if (!ev) return;
    const { mx, my, cx, cy } = getPos(ev);
    const d = dgRef.current;
    if (!d.active) {
      const h = getAt(mx, my, stRef.current);
      stRef.current.forEach((b) => { b.hover = b === h; });
      const c = cvsRef.current;
      if (c) c.style.cursor = h ? 'pointer' : 'default';
      return;
    }
    if (d.bubble) {
      const dx = cx - d.startX, dy = cy - d.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 10 && d.longPressTimer) {
        clearTimeout(d.longPressTimer);
        d.longPressTimer = null;
        d.moved = true;
      }
      const mdx = cx - d.lastX, mdy = cy - d.lastY;
      d.bubble.px += mdx;
      d.bubble.py += mdy;
      d.bubble.dragVx = mdx * 0.3;
      d.bubble.dragVy = mdy * 0.3;
      d.lastX = cx;
      d.lastY = cy;
    }
  }, [getPos]);

  const onUp = useCallback((e: MouseEvent | TouchEvent) => {
    const d = dgRef.current;
    if (!d.active) return;
    if (d.longPressTimer) {
      clearTimeout(d.longPressTimer);
      d.longPressTimer = null;
    }
    const bub = d.bubble;
    if (!bub) { d.active = false; return; }
    if (!d.longPressTriggered && !d.moved) {
      const ev = 'changedTouches' in e ? e.changedTouches[0] : e;
      onBubbleClick?.(bub.data, ev?.clientX ?? 0, ev?.clientY ?? 0);
    } else if (d.moved) {
      bub.vx = bub.dragVx;
      bub.vy = bub.dragVy;
    }
    d.active = false;
    d.bubble = null;
  }, [onBubbleClick]);

  useEffect(() => {
    const cvs = cvsRef.current, ctr = ctrRef.current;
    if (!cvs || !ctr) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = ctr.getBoundingClientRect();
      cvs.width = rect.width * dpr;
      cvs.height = rect.height * dpr;
      cvs.style.width = rect.width + 'px';
      cvs.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    cvs.addEventListener('mousedown', onDn);
    cvs.addEventListener('mousemove', onMv);
    window.addEventListener('mouseup', onUp);
    cvs.addEventListener('touchstart', onDn, { passive: false });
    cvs.addEventListener('touchmove', onMv, { passive: false });
    window.addEventListener('touchend', onUp);

    const animate = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      tRef.current += dt;
      const t = tRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = cvs.width / dpr, H = cvs.height / dpr;
      ctx.clearRect(0, 0, W, H);

      const ss = stRef.current;
      for (const b of ss) {
        if (b.popped) { b.popTimer += dt; continue; }
        b.vx += (Math.random() - 0.5) * 0.02;
        b.vy += (Math.random() - 0.5) * 0.02 - 0.003;
        b.vx *= 0.995; b.vy *= 0.995;
        b.px += b.vx + b.dragVx;
        b.py += b.vy + b.dragVy;
        b.dragVx *= 0.9; b.dragVy *= 0.9;
        if (b.px < b.pr) { b.px = b.pr; b.vx *= -0.7; }
        if (b.px > W - b.pr) { b.px = W - b.pr; b.vx *= -0.7; }
        if (b.py < b.pr) { b.py = b.pr; b.vy *= -0.7; }
        if (b.py > H - b.pr) { b.py = H - b.pr; b.vy *= -0.7; }
      }

      // Draw connections
      ctx.save();
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          const a = ss[i], bb = ss[j];
          if (a.popped || bb.popped) continue;
          const dist = Math.hypot(bb.px - a.px, bb.py - a.py);
          const maxD = (a.pr + bb.pr) * 2.5;
          if (dist < maxD) {
            ctx.beginPath();
            ctx.moveTo(a.px, a.py);
            ctx.lineTo(bb.px, bb.py);
            ctx.strokeStyle = hexRgba(a.data.color, (1 - dist / maxD) * 0.15);
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // ===== DRAW BUBBLES =====
      // Pass 1: Draw content inside each bubble (visible through the film)
      for (const b of ss) {
        if (b.popped) continue;
        const wobblePhase = t * 2 + b.px * 0.01 + b.py * 0.01;
        drawBubbleContent(b, ctx, t + b.px * 0.002);
        drawBubbleFilm(b, ctx, t + b.px * 0.002, wobblePhase);
      }

      // Pass 2: Handle popped bubbles (just fade out the film)
      for (const b of ss) {
        if (!b.popped) continue;
        b.popTimer += dt;
        const s = Math.max(0, 1 - b.popTimer / 0.5);
        if (s <= 0.01) continue;
        const r = b.pr * s;
        ctx.save();
        ctx.globalAlpha = s;
        const wobblePhase = t * 2 + b.px * 0.01;
        drawBubbleContent(b, ctx, t + b.px * 0.002);
        drawBubbleFilm({ ...b, pr: r }, ctx, t + b.px * 0.002, wobblePhase);
        ctx.restore();
      }

      stRef.current = ss.filter((b) => !(b.popped && b.popTimer > 0.5));
      aRef.current = requestAnimationFrame(animate);
    };

    aRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(aRef.current);
      window.removeEventListener('resize', resize);
      cvs.removeEventListener('mousedown', onDn);
      cvs.removeEventListener('mousemove', onMv);
      window.removeEventListener('mouseup', onUp);
      cvs.removeEventListener('touchstart', onDn);
      cvs.removeEventListener('touchmove', onMv);
      window.removeEventListener('touchend', onUp);
    };
  }, [onDn, onMv, onUp]);

  return (
    <div ref={ctrRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={cvsRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
