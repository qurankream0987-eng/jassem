import { useState, useCallback, useContext, useRef, useMemo } from 'react';
import { WindowContext } from '@/context/WindowContext';
import BubbleCanvas from './BubbleCanvas';
import type { BubbleData, PopParticle } from './BubbleCanvas';

// ─── Bubble Content Components (lazy inline) ─────────────────────────────────

function RestaurantsContent() {
  return (
    <div style={{ color: 'white', padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>🍽️ مطاعم</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        اكتشف أفضل المطاعم في منطقتك. تصفح القوائم، اطلب وجبتك، وتتبع طلبك مباشرة.
      </p>
    </div>
  );
}

function PharmacyContent() {
  return (
    <div style={{ color: 'white', padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>💊 صيدليات</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        ابحث عن الأدوية، تحقق من التوافر، واطلب توصيلاً سريعاً إلى باب منزلك.
      </p>
    </div>
  );
}

function FashionContent() {
  return (
    <div style={{ color: 'white', padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>👗 موضة</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        تسوق أحدث صيحات الموضة من أفضل المتاجر. تصفح، قارن، واشتري بسهولة.
      </p>
    </div>
  );
}

function GroceryContent() {
  return (
    <div style={{ color: 'white', padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>🛒 بقالة</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        اطلب احتياجاتك اليومية من البقالة. خضروات طازجة، لحوم، منتجات تنظيف وغيرها.
      </p>
    </div>
  );
}

function DeliveryContent() {
  return (
    <div style={{ color: 'white', padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>🚚 توصيل</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        خدمة توصيل سريعة وموثوقة لجميع طلباتك. تتبع مباشر وتوصيل في نفس اليوم.
      </p>
    </div>
  );
}

function JobsContent() {
  return (
    <div style={{ color: 'white', padding: 16 }}>
      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>💼 توظيف</h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
        ابحث عن وظيفة أحلامك أو انشر فرص عمل. آلاف الفرص بانتظارك.
      </p>
    </div>
  );
}

function BubbleContent({ type }: { type: string }) {
  switch (type) {
    case 'restaurants':
      return <RestaurantsContent />;
    case 'pharmacy':
      return <PharmacyContent />;
    case 'fashion':
      return <FashionContent />;
    case 'grocery':
      return <GroceryContent />;
    case 'delivery':
      return <DeliveryContent />;
    case 'jobs':
      return <JobsContent />;
    default:
      return (
        <div style={{ color: 'white', padding: 16 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12, color: '#00d4ff' }}>✨ جاسيم</h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            مرحباً بك في منصة جاسيم الذكية.
          </p>
        </div>
      );
  }
}

// ─── Data ────────────────────────────────────────────────────────────────────

interface SourceBubble {
  id: string;
  label: string;
  icon: string;
  type: string;
  color: string;
}

const SOURCE_BUBBLES: SourceBubble[] = [
  { id: '1', label: 'مطاعم', icon: '🍽️', type: 'restaurants', color: '#00d4ff' },
  { id: '2', label: 'صيدليات', icon: '💊', type: 'pharmacy', color: '#a855f7' },
  { id: '3', label: 'موضة', icon: '👗', type: 'fashion', color: '#ec4899' },
  { id: '4', label: 'بقالة', icon: '🛒', type: 'grocery', color: '#4a9eff' },
  { id: '5', label: 'توصيل', icon: '🚚', type: 'delivery', color: '#00c896' },
  { id: '6', label: 'توظيف', icon: '💼', type: 'jobs', color: '#FFD700' },
];

// Normalized positions (0-1)
const POSITIONS_NORM = [
  { x: 0.12, y: 0.22 },
  { x: 0.90, y: 0.28 },
  { x: 0.06, y: 0.42 },
  { x: 0.94, y: 0.48 },
  { x: 0.16, y: 0.62 },
  { x: 0.86, y: 0.66 },
];

const FLOAT_ANIMATIONS = [
  'bubbleFloat1',
  'bubbleFloat2',
  'bubbleFloat3',
  'bubbleFloat4',
  'bubbleFloat5',
  'bubbleFloat6',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface FloatingBubblesProps {
  onBubbleOpen: (type: string, label: string) => void;
}

interface PoppedRecord {
  id: string;
  x: number;
  y: number;
  at: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FloatingBubbles({ onBubbleOpen }: FloatingBubblesProps) {
  const windowCtx = useContext(WindowContext);
  const [poppedBubbles, setPoppedBubbles] = useState<PoppedRecord[]>([]);
  const [popParticles, setPopParticles] = useState<PopParticle[]>([]);
  const nextParticleId = useRef(1);

  // ── Pop a bubble: create 60 particles (40 colored + 20 white) ──
  const handlePop = useCallback(
    (id: string, x: number, y: number) => {
      const now = performance.now();
      setPoppedBubbles((prev) => [...prev, { id, x, y, at: now }]);

      const particles: PopParticle[] = [];

      // 40 colored particles
      for (let i = 0; i < 40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 120;
        const colors = ['#00d4ff', '#a855f7', '#ec4899', '#4a9eff', '#00c896'];
        particles.push({
          id: nextParticleId.current++,
          x,
          y,
          tx: Math.cos(angle) * speed,
          ty: Math.sin(angle) * speed,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 2 + Math.random() * 3,
          bornAt: now,
          lifeMs: 600 + Math.random() * 400,
        });
      }

      // 20 white particles
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 100;
        particles.push({
          id: nextParticleId.current++,
          x,
          y,
          tx: Math.cos(angle) * speed,
          ty: Math.sin(angle) * speed,
          color: '#ffffff',
          size: 1.5 + Math.random() * 2,
          bornAt: now,
          lifeMs: 500 + Math.random() * 300,
        });
      }

      setPopParticles((prev) => [...prev, ...particles]);

      // Clean up particles after max lifetime
      setTimeout(() => {
        setPopParticles((prev) => prev.filter((p) => !particles.find((np) => np.id === p.id)));
      }, 1100);

      // Clean up popped record after animation
      setTimeout(() => {
        setPoppedBubbles((prev) => prev.filter((b) => b.id !== id));
      }, 2000);
    },
    []
  );

  // ── Bubble click → open window ──
  const handleBubbleClick = useCallback(
    (id: string) => {
      const bubble = SOURCE_BUBBLES.find((b) => b.id === id);
      if (!bubble) return;

      onBubbleOpen(bubble.type, bubble.label);
      windowCtx?.openWindow(
        bubble.label,
        <BubbleContent type={bubble.type} />,
        { width: 380, height: 640 }
      );
    },
    [onBubbleOpen, windowCtx]
  );

  // ── Build BubbleData[] for BubbleCanvas ──
  const visibleBubbles: BubbleData[] = useMemo(() => {
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const screenH = typeof window !== 'undefined' ? window.innerHeight : 768;

    // Base radius based on screen size
    const baseRadius = Math.min(60, Math.max(45, screenW * 0.065));

    return SOURCE_BUBBLES.filter((b) => !poppedBubbles.find((p) => p.id === b.id)).map(
      (bubble, index) => {
        const pos = POSITIONS_NORM[index];
        return {
          id: bubble.id,
          x: pos.x,
          y: pos.y,
          radius: baseRadius,
          label: bubble.label,
          icon: bubble.icon,
          color: bubble.color,
          wobblePhase: index * 1.2,
          opacity: 1,
          floatAnim: FLOAT_ANIMATIONS[index],
          floatDuration: 4 + (index % 3),
          floatIndex: index,
        };
      }
    );
  }, [poppedBubbles]);

  return (
    <BubbleCanvas
      bubbles={visibleBubbles}
      popParticles={popParticles}
      onBubbleClick={handleBubbleClick}
      onBubbleLongPress={handlePop}
      longPressThreshold={400}
    />
  );
}
