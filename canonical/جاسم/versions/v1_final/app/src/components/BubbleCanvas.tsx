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
interface BState { data: BubbleData; px: number; py: number; pr: number; vx: number; vy: number; dragVx: number; dragVy: number; popped: boolean; popTimer: number; hover: boolean; }
interface DragSt { active: boolean; bubble: BState | null; startX: number; startY: number; lastX: number; lastY: number; longPressTimer: ReturnType<typeof setTimeout> | null; longPressTriggered: boolean; moved: boolean; }

function hexRgba(hex: string, a: number) { const h = hex.replace('#', ''); const b = parseInt(h, 16); return `rgba(${(b>>16)&255},${(b>>8)&255},${b&255},${a})`; }
function getAt(mx: number, my: number, bs: BState[]) { for (let i = bs.length - 1; i >= 0; i--) { const b = bs[i]; if (b.popped) continue; const dx = mx - b.px, dy = my - b.py; if (dx * dx + dy * dy < (b.pr + 10) * (b.pr + 10)) return b; } return null; }
function popParts(x: number, y: number, color: string) { for (let i = 0; i < 12; i++) { const s = 2 + Math.random() * 6, a = (Math.PI * 2 * i) / 12 + Math.random() * 0.5, sp = 40 + Math.random() * 100, tx = Math.cos(a) * sp, ty = Math.sin(a) * sp, d = 0.5 + Math.random() * 0.4; const p = document.createElement('div'); p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(circle,${color},transparent);pointer-events:none;z-index:999;--tx:${tx}px;--ty:${ty}px;animation:popFly ${d}s ease-out forwards;`; document.body.appendChild(p); setTimeout(() => p.remove(), d * 1000 + 50); } }

export default function BubbleCanvas({ bubbles, onBubbleClick, onBubblePop }: BubbleCanvasProps) {
  const cvsRef = useRef<HTMLCanvasElement>(null);
  const ctrRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<BState[]>([]);
  const dgRef = useRef<DragSt>({ active: false, bubble: null, startX: 0, startY: 0, lastX: 0, lastY: 0, longPressTimer: null, longPressTriggered: false, moved: false });
  const tRef = useRef(0);
  const aRef = useRef(0);

  useEffect(() => {
    const ex = stRef.current;
    stRef.current = bubbles.map((d) => { const p = ex.find((e) => e.data.id === d.id); if (p && !p.popped) return { ...p, data: d, px: d.x, py: d.y }; return { data: d, px: d.x, py: d.y, pr: d.r, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, dragVx: 0, dragVy: 0, popped: false, popTimer: 0, hover: false }; });
  }, [bubbles]);

  const getPos = useCallback((e: MouseEvent | Touch) => { const c = cvsRef.current; if (!c) return { mx: 0, my: 0, cx: 0, cy: 0 }; const r = c.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top, cx: e.clientX, cy: e.clientY }; }, []);

  const onDn = useCallback((e: MouseEvent | TouchEvent) => { const ev = 'touches' in e ? e.touches[0] : e; if (!ev) return; e.preventDefault(); const { mx, my, cx, cy } = getPos(ev); const b = getAt(mx, my, stRef.current); if (!b) return; const d = dgRef.current; d.active = true; d.bubble = b; d.startX = cx; d.startY = cy; d.lastX = cx; d.lastY = cy; d.longPressTriggered = false; d.moved = false; d.longPressTimer = setTimeout(() => { if (d.active && d.bubble && !d.moved) { d.longPressTriggered = true; d.active = false; const bub = d.bubble; bub.popped = true; bub.popTimer = 0; popParts(cx, cy, bub.data.color); onBubblePop?.(cx, cy, bub.data.color); d.bubble = null; } }, 400); }, [getPos, onBubblePop]);
  const onMv = useCallback((e: MouseEvent | TouchEvent) => { const ev = 'touches' in e ? e.touches[0] : e; if (!ev) return; const { mx, my, cx, cy } = getPos(ev); const d = dgRef.current; if (!d.active) { const h = getAt(mx, my, stRef.current); stRef.current.forEach((b) => { b.hover = b === h; }); const c = cvsRef.current; if (c) c.style.cursor = h ? 'pointer' : 'default'; return; } if (d.bubble) { const dx = cx - d.startX, dy = cy - d.startY; if (Math.sqrt(dx * dx + dy * dy) > 10 && d.longPressTimer) { clearTimeout(d.longPressTimer); d.longPressTimer = null; d.moved = true; } const mdx = cx - d.lastX, mdy = cy - d.lastY; d.bubble.px += mdx; d.bubble.py += mdy; d.bubble.dragVx = mdx * 0.3; d.bubble.dragVy = mdy * 0.3; d.lastX = cx; d.lastY = cy; } }, [getPos]);
  const onUp = useCallback((e: MouseEvent | TouchEvent) => { const d = dgRef.current; if (!d.active) return; if (d.longPressTimer) { clearTimeout(d.longPressTimer); d.longPressTimer = null; } const bub = d.bubble; if (!bub) { d.active = false; return; } if (!d.longPressTriggered && !d.moved) { const ev = 'changedTouches' in e ? e.changedTouches[0] : e; onBubbleClick?.(bub.data, ev?.clientX ?? 0, ev?.clientY ?? 0); } else if (d.moved) { bub.vx = bub.dragVx; bub.vy = bub.dragVy; } d.active = false; d.bubble = null; }, [onBubbleClick]);

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
      for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) { const a = ss[i], bb = ss[j]; if (a.popped || bb.popped) continue; const dist = Math.hypot(bb.px - a.px, bb.py - a.py); const maxD = (a.pr + bb.pr) * 2.5; if (dist < maxD) { ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(bb.px, bb.py); ctx.strokeStyle = hexRgba(a.data.color, (1 - dist / maxD) * 0.15); ctx.lineWidth = 1; ctx.stroke(); } }
      ctx.restore();

      // ===== DRAW BUBBLES =====
      for (const b of ss) {
        const { px, py, pr, popped, popTimer, baseR, data, hover } = b;
        const { color, color2, label } = data;
        let r = pr;
        if (popped) { const s = Math.max(0, 1 - popTimer / 0.5); r = baseR * s; if (r <= 0.5) continue; }
        r *= hover ? 1.08 : 1.0;
        const x = px, y = py;

        // Glow
        ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.2);
        g.addColorStop(0, hexRgba(color, 0.1));
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.fill();

        // Body
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        const body = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
        body.addColorStop(0, hexRgba(color, 0.35));
        body.addColorStop(0.5, hexRgba(color2, 0.15));
        body.addColorStop(0.85, hexRgba(color, 0.08));
        body.addColorStop(1, hexRgba(color2, 0.25));
        ctx.fillStyle = body; ctx.fill();

        // Inner highlight (specular)
        const hlx = x - r * 0.3, hly = y - r * 0.3;
        ctx.beginPath(); ctx.arc(hlx, hly, r * 0.35, 0, Math.PI * 2);
        const hl = ctx.createRadialGradient(hlx, hly, 0, hlx, hly, r * 0.35);
        hl.addColorStop(0, 'rgba(255,255,255,0.5)');
        hl.addColorStop(0.5, 'rgba(255,255,255,0.1)');
        hl.addColorStop(1, 'transparent');
        ctx.fillStyle = hl; ctx.fill();

        // Rim
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        const rim = ctx.createRadialGradient(x, y, r * 0.8, x, y, r);
        rim.addColorStop(0, 'transparent');
        rim.addColorStop(0.9, hexRgba(color, 0.4));
        rim.addColorStop(1, hexRgba(color2, 0.6));
        ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.stroke();

        // Label
        if (r > 20 && !popped) {
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.font = `bold 13px 'Noto Sans Arabic', sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
          ctx.fillText(label, x, y);
          ctx.shadowBlur = 0;
        }
      }

      stRef.current = ss.filter((b) => !(b.popped && b.popTimer > 0.5));
      aRef.current = requestAnimationFrame(animate);
    };

    aRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(aRef.current);
      window.removeEventListener('resize', resize);
      cvs.removeEventListener('mousedown', onDn); cvs.removeEventListener('mousemove', onMv); window.removeEventListener('mouseup', onUp);
      cvs.removeEventListener('touchstart', onDn); cvs.removeEventListener('touchmove', onMv); window.removeEventListener('touchend', onUp);
    };
  }, [onDn, onMv, onUp]);

  return <div ref={ctrRef} style={{ position: 'absolute', inset: 0 }}><canvas ref={cvsRef} style={{ display: 'block', width: '100%', height: '100%' }} /></div>;
}
