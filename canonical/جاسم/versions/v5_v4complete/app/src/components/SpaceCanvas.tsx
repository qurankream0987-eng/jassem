import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface NeuralNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
}

export default function SpaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);
  const nodesRef = useRef<NeuralNode[]>([]);
  const dustRef = useRef<DustMote[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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

    // Initialize stars
    const starCount = 250;
    starsRef.current = Array.from({ length: starCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 1.5 + 0.3,
      opacity: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleOffset: Math.random() * Math.PI * 2,
    }));

    // Initialize neural nodes
    const nodeCount = 35;
    nodesRef.current = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 3 + 3, // 3-6px
    }));

    // Initialize dust motes
    const dustCount = 8;
    dustRef.current = Array.from({ length: dustCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15 - 0.05,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.3 + 0.1,
    }));

    const animate = (time: number) => {
      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#000011');
      bgGrad.addColorStop(1, '#000033');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Draw stars with twinkle
      starsRef.current.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset);
        const alpha = star.opacity * (0.5 + twinkle * 0.5);
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      });

      // Slow parallax drift for stars
      starsRef.current.forEach((star) => {
        star.x -= 0.02;
        star.y -= 0.01;
        if (star.x < 0) star.x = w;
        if (star.y < 0) star.y = h;
      });

      // Update and draw neural nodes with connections
      const nodes = nodesRef.current;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.x += node.vx;
        node.y += node.vy;

        // Bounce off edges
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;

        // Draw connections
        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j];
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

      // Draw nodes
      nodes.forEach((node) => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 212, 255, 0.7)';
        ctx.fill();

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
      });

      // Draw dust motes
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
