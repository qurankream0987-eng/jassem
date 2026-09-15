import { useEffect, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  layer: number; // 0=far (slow), 1=mid, 2=close (fast)
  colorTint: string | null; // slight color for some stars
}

interface NeuralNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

interface NeuralThread {
  from: number; // index into nodes array
  to: number;   // index into nodes array
  cp1x: number; // control point 1
  cp1y: number;
  cp2x: number; // control point 2 (optional, -1 if not used)
  cp2y: number;
  baseAlpha: number;
  pulseSpeed: number;
  pulseOffset: number;
}

interface NebulaCloud {
  x: number;
  y: number;
  rx: number; // radius x
  ry: number; // radius y
  color: string;
  opacity: number;
  driftVx: number;
  driftVy: number;
  driftPhase: number;
}

interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NEBULA_COLORS = ['#00d4ff', '#a855f7', '#ec4899', '#4a9eff'];
const STAR_COLORS = ['#00d4ff', '#a855f7', '#ec4899', null]; // null = white
const STAR_LAYER_SPEEDS = [0.015, 0.035, 0.06];
const STAR_LAYER_SIZES = [0.8, 1.2, 1.8];

// ─── Component ───────────────────────────────────────────────────────────────

export default function SpaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);
  const nodesRef = useRef<NeuralNode[]>([]);
  const threadsRef = useRef<NeuralThread[]>([]);
  const nebulaeRef = useRef<NebulaCloud[]>([]);
  const dustRef = useRef<DustMote[]>([]);
  const timeRef = useRef<number>(0);

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
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener('resize', resize);

    // ── Initialize Stars (250) with 3 parallax layers ──
    const starCount = 250;
    starsRef.current = Array.from({ length: starCount }, () => {
      const layer = Math.floor(Math.random() * 3);
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        size: (Math.random() * 1.5 + 0.3) * STAR_LAYER_SIZES[layer],
        opacity: Math.random() * 0.8 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        twinkleOffset: Math.random() * Math.PI * 2,
        layer,
        colorTint: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      };
    });

    // ── Initialize Neural Nodes (35) ──
    const nodeCount = 35;
    nodesRef.current = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 3 + 3, // 3-6px
    }));

    // ── Initialize Neural Threads (50 curved bezier lines) ──
    const threadCount = 50;
    const nodes = nodesRef.current;
    const threads: NeuralThread[] = [];
    const usedPairs = new Set<string>();
    let attempts = 0;
    while (threads.length < threadCount && attempts < 1000) {
      attempts++;
      const fromIdx = Math.floor(Math.random() * nodeCount);
      const toIdx = Math.floor(Math.random() * nodeCount);
      if (fromIdx === toIdx) continue;

      const key = fromIdx < toIdx ? `${fromIdx}-${toIdx}` : `${toIdx}-${fromIdx}`;
      if (usedPairs.has(key)) continue;

      const fromNode = nodes[fromIdx];
      const toNode = nodes[toIdx];
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 50 || dist > 400) continue;

      usedPairs.add(key);

      // 1-3 control points → 1-2 bezier control points
      const numCP = Math.random() > 0.5 ? 2 : 1;
      const cpOffset = dist * 0.3;

      const cp1x = fromNode.x + dx * 0.3 + (Math.random() - 0.5) * cpOffset;
      const cp1y = fromNode.y + dy * 0.3 + (Math.random() - 0.5) * cpOffset;
      let cp2x = -1;
      let cp2y = -1;
      if (numCP === 2) {
        cp2x = fromNode.x + dx * 0.7 + (Math.random() - 0.5) * cpOffset;
        cp2y = fromNode.y + dy * 0.7 + (Math.random() - 0.5) * cpOffset;
      }

      const baseAlpha = 0.1 + (1 - dist / 400) * 0.2;
      threads.push({
        from: fromIdx,
        to: toIdx,
        cp1x,
        cp1y,
        cp2x,
        cp2y,
        baseAlpha,
        pulseSpeed: Math.random() * 0.001 + 0.0005,
        pulseOffset: Math.random() * Math.PI * 2,
      });
    }
    threadsRef.current = threads;

    // ── Initialize Nebula Clouds (8) ──
    const nebulaCount = 8;
    nebulaeRef.current = Array.from({ length: nebulaCount }, () => {
      const color = NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)];
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        rx: 200 + Math.random() * 200, // 200-400px
        ry: 150 + Math.random() * 150, // 150-300px
        color,
        opacity: 0.03 + Math.random() * 0.05, // 0.03-0.08
        driftVx: (Math.random() - 0.5) * 0.08,
        driftVy: (Math.random() - 0.5) * 0.06,
        driftPhase: Math.random() * Math.PI * 2,
      };
    });

    // ── Initialize Dust Motes ──
    const dustCount = 8;
    dustRef.current = Array.from({ length: dustCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15 - 0.05,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.3 + 0.1,
    }));

    // ─── Animation Loop ────────────────────────────────────────────────────

    const animate = (time: number) => {
      timeRef.current = time;
      ctx.clearRect(0, 0, w, h);

      // ── Background gradient ──
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#000011');
      bgGrad.addColorStop(1, '#000033');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── Nebula Clouds (drawn first, behind everything) ──
      nebulaeRef.current.forEach((cloud) => {
        // Drift
        cloud.x += cloud.driftVx + Math.sin(time * 0.0001 + cloud.driftPhase) * 0.02;
        cloud.y += cloud.driftVy + Math.cos(time * 0.00008 + cloud.driftPhase) * 0.015;

        // Wrap around
        if (cloud.x < -cloud.rx) cloud.x = w + cloud.rx;
        if (cloud.x > w + cloud.rx) cloud.x = -cloud.rx;
        if (cloud.y < -cloud.ry) cloud.y = h + cloud.ry;
        if (cloud.y > h + cloud.ry) cloud.y = -cloud.ry;

        const grad = ctx.createRadialGradient(
          cloud.x, cloud.y, 0,
          cloud.x, cloud.y, Math.max(cloud.rx, cloud.ry)
        );
        // Parse hex to rgb for gradient
        const hex = cloud.color;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${cloud.opacity})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${cloud.opacity * 0.5})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, cloud.rx, cloud.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      });

      // ── Stars with twinkle + parallax layers ──
      starsRef.current.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset);
        const alpha = star.opacity * (0.5 + twinkle * 0.5);

        // Parallax drift based on layer
        const speed = STAR_LAYER_SPEEDS[star.layer];
        star.x -= speed;
        star.y -= speed * 0.5;
        if (star.x < 0) star.x = w;
        if (star.y < 0) star.y = h;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);

        if (star.colorTint) {
          const hex = star.colorTint;
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } else {
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        }
        ctx.fill();
      });

      // ── Update neural nodes ──
      const curNodes = nodesRef.current;
      for (let i = 0; i < curNodes.length; i++) {
        const node = curNodes[i];
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;
      }

      // ── Neural Threads (curved bezier connections) ──
      threadsRef.current.forEach((thread) => {
        const fromNode = curNodes[thread.from];
        const toNode = curNodes[thread.to];
        if (!fromNode || !toNode) return;

        const pulse = Math.sin(time * thread.pulseSpeed + thread.pulseOffset);
        const alpha = thread.baseAlpha * (0.6 + pulse * 0.4);

        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        if (thread.cp2x >= 0) {
          ctx.bezierCurveTo(
            thread.cp1x, thread.cp1y,
            thread.cp2x, thread.cp2y,
            toNode.x, toNode.y
          );
        } else {
          ctx.quadraticCurveTo(thread.cp1x, thread.cp1y, toNode.x, toNode.y);
        }
        ctx.strokeStyle = `rgba(0, 212, 255, ${Math.max(0, alpha)})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      });

      // ── Keep existing: direct node connections (distance-based) ──
      for (let i = 0; i < curNodes.length; i++) {
        const node = curNodes[i];
        for (let j = i + 1; j < curNodes.length; j++) {
          const other = curNodes[j];
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 150) {
            const alpha = (1 - dist / 150) * 0.3;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // ── Draw neural nodes ──
      curNodes.forEach((node) => {
        // Glow
        const glow = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, node.size * 3
        );
        glow.addColorStop(0, 'rgba(0, 212, 255, 0.15)');
        glow.addColorStop(1, 'rgba(0, 212, 255, 0)');
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 212, 255, 0.7)';
        ctx.fill();
      });

      // ── Dust motes ──
      dustRef.current.forEach((dust) => {
        dust.x += dust.vx;
        dust.y += dust.vy;
        if (dust.x < -10) dust.x = w + 10;
        if (dust.x > w + 10) dust.x = -10;
        if (dust.y < -10) dust.y = h + 10;
        if (dust.y > h + 10) dust.y = -10;

        ctx.beginPath();
        ctx.arc(dust.x, dust.y, dust.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${dust.opacity})`;
        ctx.fill();
      });

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
      }}
    />
  );
}
