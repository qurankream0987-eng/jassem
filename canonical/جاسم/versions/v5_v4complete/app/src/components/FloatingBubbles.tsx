import { useState, useCallback, useRef } from 'react';

export interface BubbleData {
  id: string;
  label: string;
  image: string;
  type: string;
}

interface BubblePosition {
  top: string;
  left?: string;
  right?: string;
}

const BUBBLES: BubbleData[] = [
  { id: '1', label: 'مطاعم', image: '/bubble-restaurants.jpg', type: 'restaurants' },
  { id: '2', label: 'صيدليات', image: '/bubble-pharmacy.jpg', type: 'pharmacy' },
  { id: '3', label: 'موضة', image: '/bubble-fashion.jpg', type: 'fashion' },
  { id: '4', label: 'بقالة', image: '/bubble-grocery.jpg', type: 'grocery' },
  { id: '5', label: 'توصيل', image: '/bubble-delivery.jpg', type: 'delivery' },
  { id: '6', label: 'توظيف', image: '/bubble-jobs.jpg', type: 'jobs' },
];

const POSITIONS: BubblePosition[] = [
  { top: '22%', left: '12%' },
  { top: '28%', right: '10%' },
  { top: '42%', left: '6%' },
  { top: '48%', right: '6%' },
  { top: '62%', left: '16%' },
  { top: '66%', right: '14%' },
];

const FLOAT_ANIMATIONS = [
  'bubbleFloat1',
  'bubbleFloat2',
  'bubbleFloat3',
  'bubbleFloat4',
  'bubbleFloat5',
  'bubbleFloat6',
];

interface FloatingBubblesProps {
  onBubbleOpen: (type: string, label: string) => void;
}

interface PoppedBubble {
  id: string;
  x: number;
  y: number;
}

interface PopParticle {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
}

// Individual Bubble component so each can use its own long-press logic safely
function BubbleItem({
  bubble,
  index,
  onOpen,
  onPop,
}: {
  bubble: BubbleData;
  index: number;
  onOpen: (type: string, label: string) => void;
  onPop: (id: string, x: number, y: number) => void;
}) {
  const pos = POSITIONS[index];
  const anim = FLOAT_ANIMATIONS[index];
  const duration = 4 + (index % 3);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const startTimeRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      isLongPressRef.current = false;
      startTimeRef.current = Date.now();

      timerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        const clientX = e.clientX;
        const clientY = e.clientY;
        onPop(bubble.id, clientX, clientY);
        timerRef.current = null;
      }, 600);
    },
    [bubble.id, onPop]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const elapsed = Date.now() - startTimeRef.current;
      if (!isLongPressRef.current && elapsed < 600) {
        onOpen(bubble.type, bubble.label);
      }

      isLongPressRef.current = false;
    },
    [bubble.type, bubble.label, onOpen]
  );

  const handlePointerLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    isLongPressRef.current = false;
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{
        position: 'absolute',
        top: pos.top,
        left: pos.left,
        right: pos.right,
        transform: 'translate(-50%, -50%)',
        width: 'clamp(100px, 14vw, 150px)',
        height: 'clamp(100px, 14vw, 150px)',
        borderRadius: '50%',
        background: 'rgba(0, 0, 17, 0.35)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1.5px solid rgba(255, 255, 255, 0.15)',
        boxShadow: `
          0 0 20px rgba(0, 212, 255, 0.15),
          0 0 40px rgba(168, 85, 247, 0.08),
          inset 0 0 20px rgba(255, 255, 255, 0.03)
        `,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        pointerEvents: 'auto',
        animation: `${anim} ${duration}s ease-in-out infinite`,
        transition: 'transform 0.2s ease, box-shadow 0.3s ease',
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.08)';
        e.currentTarget.style.boxShadow = `
          0 0 30px rgba(0, 212, 255, 0.3),
          0 0 60px rgba(168, 85, 247, 0.15),
          inset 0 0 25px rgba(255, 255, 255, 0.05)
        `;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
        e.currentTarget.style.boxShadow = `
          0 0 20px rgba(0, 212, 255, 0.15),
          0 0 40px rgba(168, 85, 247, 0.08),
          inset 0 0 20px rgba(255, 255, 255, 0.03)
        `;
      }}
    >
      {/* Iridescent rim overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          padding: '2px',
          background: 'linear-gradient(135deg, rgba(0,212,255,0.4), rgba(168,85,247,0.3), rgba(236,72,153,0.3), rgba(0,212,255,0.4))',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          pointerEvents: 'none',
          animation: 'borderRotate 8s linear infinite',
        }}
      />

      {/* Image */}
      <img
        src={bubble.image}
        alt={bubble.label}
        draggable={false}
        style={{
          width: '78%',
          height: '78%',
          borderRadius: '50%',
          objectFit: 'cover',
          pointerEvents: 'none',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      />

      {/* Label */}
      <span
        style={{
          position: 'absolute',
          bottom: '-20px',
          fontSize: '11px',
          fontWeight: 600,
          color: 'rgba(255, 255, 255, 0.9)',
          textShadow: '0 0 8px rgba(0, 0, 0, 0.8)',
          whiteSpace: 'nowrap',
        }}
      >
        {bubble.label}
      </span>
    </div>
  );
}

export default function FloatingBubbles({ onBubbleOpen }: FloatingBubblesProps) {
  const [poppedBubbles, setPoppedBubbles] = useState<PoppedBubble[]>([]);
  const [popParticles, setPopParticles] = useState<PopParticle[]>([]);

  const handlePop = useCallback((id: string, x: number, y: number) => {
    setPoppedBubbles((prev) => [...prev, { id, x, y }]);

    const particles: PopParticle[] = Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2;
      const distance = 40 + Math.random() * 60;
      return {
        id: Date.now() + i,
        x,
        y,
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance,
        color: ['#00d4ff', '#a855f7', '#ec4899', '#4a9eff'][i % 4],
      };
    });
    setPopParticles((prev) => [...prev, ...particles]);

    setTimeout(() => {
      setPopParticles((prev) => prev.filter((p) => !particles.find((np) => np.id === p.id)));
    }, 700);
  }, []);

  const visibleBubbles = BUBBLES.filter((b) => !poppedBubbles.find((p) => p.id === b.id));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      {visibleBubbles.map((bubble, index) => (
        <BubbleItem
          key={bubble.id}
          bubble={bubble}
          index={index}
          onOpen={onBubbleOpen}
          onPop={handlePop}
        />
      ))}

      {/* Pop particles */}
      {popParticles.map((particle) => (
        <div
          key={particle.id}
          style={{
            position: 'fixed',
            left: particle.x,
            top: particle.y,
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: particle.color,
            pointerEvents: 'none',
            boxShadow: `0 0 6px ${particle.color}`,
            // @ts-expect-error CSS custom properties for animation
            '--tx': `${particle.tx}px`,
            '--ty': `${particle.ty}px`,
            animation: 'popFly 0.6s ease forwards',
          }}
        />
      ))}
    </div>
  );
}
