import { useEffect, useRef } from 'react';

interface Nebula { x: number; y: number; vx: number; vy: number; radius: number; hue: number; alpha: number; phase: number; }
interface Line { angle: number; length: number; amp: number; freq: number; phase: number; speed: number; width: number; alpha: number; hue: number; }
interface Particle { x: number; y: number; vx: number; vy: number; size: number; alpha: number; twinkle: number; hue: number; }
interface Node { x: number; y: number; vx: number; vy: number; size: number; alpha: number; pulse: number; }

function getCol(hue: number, a: number): string {
  let r: number, g: number, b: number;
  if (hue < 0.25) { const t = hue / 0.25; r = 0; g = Math.round(200 + t * 55); b = 255; }
  else if (hue < 0.5) { const t = (hue - 0.25) / 0.25; r = Math.round(t * 150); g = Math.round(255 - t * 155); b = 255; }
  else if (hue < 0.75) { const t = (hue - 0.5) / 0.25; r = 150 + Math.round(t * 105); g = 100 - Math.round(t * 50); b = 255 - Math.round(t * 100); }
  else { const t = (hue - 0.75) / 0.25; r = 255 - Math.round(t * 255); g = 50 + Math.round(t * 150); b = 155 + Math.round(t * 100); }
  return `rgba(${r},${g},${b},${a})`;
}

export default function SpaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let sW: number, sH: number, sDpr: number, sTime = 0;

    function sResize() {
      sDpr = Math.min(window.devicePixelRatio || 1, 2);
      sW = canvas!.width = window.innerWidth * sDpr;
      sH = canvas!.height = window.innerHeight * sDpr;
      canvas!.style.width = window.innerWidth + 'px';
      canvas!.style.height = window.innerHeight + 'px';
    }
    sResize();
    window.addEventListener('resize', sResize);

    const NEBULA: Nebula[] = [];
    for (let i = 0; i < 8; i++) {
      NEBULA.push({ x: Math.random() * sW, y: Math.random() * sH,
        vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12,
        radius: 120 + Math.random() * 250, hue: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85][i],
        alpha: 0.02 + Math.random() * 0.03, phase: Math.random() * Math.PI * 2 });
    }
    const LINES: Line[] = [];
    for (let i = 0; i < 50; i++) {
      LINES.push({ angle: (i / 50) * Math.PI * 2 + (Math.random() - 0.5) * 0.3,
        length: 250 + Math.random() * 600, amp: 12 + Math.random() * 35, freq: 2 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2, speed: 0.15 + Math.random() * 0.5,
        width: 0.3 + Math.random() * 0.9, alpha: 0.05 + Math.random() * 0.15, hue: Math.random() });
    }
    const PARTICLES: Particle[] = [];
    for (let i = 0; i < 250; i++) {
      PARTICLES.push({ x: Math.random() * sW, y: Math.random() * sH,
        vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.1,
        size: 0.4 + Math.random() * 1.6, alpha: 0.06 + Math.random() * 0.3,
        twinkle: 0.5 + Math.random() * 2, hue: Math.random() });
    }
    const NODES: Node[] = [];
    for (let i = 0; i < 35; i++) {
      NODES.push({ x: Math.random() * sW, y: Math.random() * sH,
        vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.1,
        size: 1 + Math.random() * 2.2, alpha: 0.1 + Math.random() * 0.25, pulse: Math.random() * Math.PI * 2 });
    }

    function sDrawBg() {
      const g = ctx!.createRadialGradient(sW / 2, sH / 2, 0, sW / 2, sH / 2, Math.max(sW, sH));
      g.addColorStop(0, '#070c1a'); g.addColorStop(0.4, '#030610'); g.addColorStop(0.8, '#010208'); g.addColorStop(1, '#000000');
      ctx!.fillStyle = g; ctx!.fillRect(0, 0, sW, sH);
    }
    function sDrawNebula() {
      for (const n of NEBULA) {
        n.x += n.vx; n.y += n.vy; n.vx *= 0.995; n.vy *= 0.995;
        if (n.x < -400) n.x = sW + 400; if (n.x > sW + 400) n.x = -400;
        if (n.y < -400) n.y = sH + 400; if (n.y > sH + 400) n.y = -400;
        const pulse = Math.sin(sTime * 0.2 + n.phase) * 0.3 + 0.7;
        const r = n.radius * pulse * sDpr;
        const gr = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
        gr.addColorStop(0, getCol(n.hue, n.alpha * 3));
        gr.addColorStop(0.5, getCol(n.hue, n.alpha));
        gr.addColorStop(1, getCol(n.hue, 0));
        ctx!.fillStyle = gr; ctx!.beginPath(); ctx!.arc(n.x, n.y, r, 0, Math.PI * 2); ctx!.fill();
      }
    }
    function sDrawNeural() {
      const cx = sW / 2, cy = sH / 2;
      for (const line of LINES) {
        const pts: { x: number; y: number }[] = []; const steps = 70;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const dist = t * line.length * sDpr;
          const wave = Math.sin(t * line.freq * Math.PI * 2 + sTime * line.speed + line.phase) * line.amp * sDpr * (1 - t * 0.35);
          const noise = Math.sin(t * 7 + sTime + line.phase) * 3.5 * sDpr * (1 - t);
          const x = cx + Math.cos(line.angle) * dist + Math.cos(line.angle + Math.PI / 2) * (wave + noise);
          const y = cy + Math.sin(line.angle) * dist + Math.sin(line.angle + Math.PI / 2) * (wave + noise);
          pts.push({ x, y });
        }
        ctx!.strokeStyle = getCol(line.hue, line.alpha); ctx!.lineWidth = line.width;
        ctx!.beginPath(); ctx!.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i].x, pts[i].y);
        ctx!.stroke();
        for (let i = 3; i < pts.length - 3; i += 6) {
          ctx!.fillStyle = getCol(line.hue, line.alpha * 0.45 * (1 - i / pts.length));
          ctx!.beginPath(); ctx!.arc(pts[i].x, pts[i].y, 1.1 * sDpr, 0, Math.PI * 2); ctx!.fill();
        }
      }
    }
    function sDrawNodes() {
      for (const n of NODES) {
        n.x += n.vx; n.y += n.vy; n.vx *= 0.98; n.vy *= 0.98;
        if (n.x < -10) n.x = sW + 10; if (n.x > sW + 10) n.x = -10;
        if (n.y < -10) n.y = sH + 10; if (n.y > sH + 10) n.y = -10;
        const pulse = Math.sin(sTime * 1.6 + n.pulse) * 0.5 + 0.5;
        const alpha = n.alpha * pulse;
        const size = n.size * (0.5 + pulse * 0.5) * sDpr;
        const g = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, size * 4);
        g.addColorStop(0, `rgba(180,220,255,${alpha * 0.35})`);
        g.addColorStop(1, 'rgba(100,150,255,0)');
        ctx!.fillStyle = g; ctx!.beginPath(); ctx!.arc(n.x, n.y, size * 4, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx!.beginPath(); ctx!.arc(n.x, n.y, size, 0, Math.PI * 2); ctx!.fill();
      }
    }
    function sDrawParticles() {
      for (const p of PARTICLES) {
        p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.vy *= 0.98;
        if (p.x < -10) p.x = sW + 10; if (p.x > sW + 10) p.x = -10;
        if (p.y < -10) p.y = sH + 10; if (p.y > sH + 10) p.y = -10;
        const tw = Math.sin(sTime * p.twinkle) * 0.5 + 0.5;
        ctx!.fillStyle = getCol(p.hue, p.alpha * tw);
        ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * sDpr, 0, Math.PI * 2); ctx!.fill();
      }
    }
    function sDrawVignette() {
      const g = ctx!.createRadialGradient(sW / 2, sH / 2, sH * 0.2, sW / 2, sH / 2, sH * 0.92);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,10,0.55)');
      ctx!.fillStyle = g; ctx!.fillRect(0, 0, sW, sH);
    }

    let sLast = performance.now();
    function sAnimate() {
      animRef.current = requestAnimationFrame(sAnimate);
      const now = performance.now();
      const dt = Math.min((now - sLast) / 1000, 0.05); sLast = now; sTime += dt;
      sDrawBg(); sDrawNebula(); sDrawNeural(); sDrawNodes(); sDrawParticles(); sDrawVignette();
    }
    sAnimate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', sResize);
    };
  }, []);

  return <canvas ref={canvasRef} id="space-canvas" className="space-canvas" />;
}
