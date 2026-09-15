import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import SpaceCanvas from '@/components/SpaceCanvas';
import BubbleCanvas from '@/components/BubbleCanvas';
import type { BubbleData } from '@/components/BubbleCanvas';
import FloatingTitle from '@/components/FloatingTitle';
import MainChat from '@/components/MainChat';
import SoapWindow from '@/components/SoapWindow';
import type { WindowItem } from '@/components/SoapWindow';
import WindowDock from '@/components/WindowDock';
import type { WindowState } from '@/context/WindowContext';
import PopParticles from '@/components/PopParticles';

// ------------------------------------------------------------------
//  Types
// ------------------------------------------------------------------

interface BubbleDef {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  color: string;
  color2: string;
  desc: string;
  items: WindowItem[];
}

interface OpenWindow {
  id: string;
  bubbleId: string;
  title: string;
  subtitle: string;
  iconSvg: string;
  iconColor: string;
  iconColor2: string;
  items: WindowItem[];
  footerText: string;
  state: 'normal' | 'maximized' | 'minimized' | 'snapped-left' | 'snapped-right';
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  prevState?: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  size: number;
  duration: number;
}

// ------------------------------------------------------------------
//  Constants
// ------------------------------------------------------------------

let NEXT_Z_INDEX = 300;
let NEXT_WINDOW_ID = 1;
const DEFAULT_WINDOW_WIDTH = 400;
const DEFAULT_WINDOW_HEIGHT = 520;

// Normalized bubble positions (0-1 range) converted to pixels at runtime
const BUBBLE_DEFS: BubbleDef[] = [
  {
    id: 'ads',
    label: 'الإعلانات',
    x: 0.15,
    y: 0.25,
    r: 70,
    color: '#FF6B00',
    color2: '#FFD700',
    desc: 'حملاتك الإعلانية',
    items: [
      { title: 'حملة اليوم', val: '1,240 مشاهدة', up: true },
      { title: 'ميزانية الشهر', val: '450 د.ك', up: false },
      { title: 'نسبة النقر', val: '3.2%', up: true },
      { title: 'تحويلات', val: '89 عملية', up: true },
    ],
  },
  {
    id: 'suggest',
    label: 'الاقتراحات',
    x: 0.85,
    y: 0.20,
    r: 65,
    color: '#00d4ff',
    color2: '#4a9eff',
    desc: 'توصيات ذكية',
    items: [
      { title: 'منتجات مشابهة', val: '15 منتج', up: true },
      { title: 'عرض خاص', val: 'خصم 30%', up: true },
      { title: 'تاجر موثوق', val: 'أحمد للإلكترونيات', up: true },
      { title: 'اتجاه السوق', val: 'الهواتف الذكية', up: true },
    ],
  },
  {
    id: 'subchat',
    label: 'دردشة فرعية',
    x: 0.12,
    y: 0.65,
    r: 75,
    color: '#a855f7',
    color2: '#ec4899',
    desc: 'محادثاتك',
    items: [
      { title: 'أحمد للإلكترونيات', val: 'مرحباً، هل المنتج متوفر؟', up: true },
      { title: 'محل البركة', val: 'تم تأكيد الطلب #4452', up: true },
      { title: 'سوق الجملة', val: 'عرض جديد: 100 كرتون', up: true },
      { title: 'مستودع الزهراء', val: 'الشحنة في الطريق', up: true },
    ],
  },
  {
    id: 'wallet',
    label: 'المحفظة',
    x: 0.88,
    y: 0.60,
    r: 68,
    color: '#00c896',
    color2: '#00d4ff',
    desc: 'رصيدك المالي',
    items: [
      { title: 'الرصيد', val: '2,450 د.ك', up: true },
      { title: 'معلق', val: '180 د.ك', up: false },
      { title: 'إيداع هذا الشهر', val: '5,200 د.ك', up: true },
      { title: 'سحب هذا الشهر', val: '3,100 د.ك', up: false },
    ],
  },
  {
    id: 'analytics',
    label: 'التحليلات',
    x: 0.50,
    y: 0.12,
    r: 62,
    color: '#ec4899',
    color2: '#a855f7',
    desc: 'إحصائيات متقدمة',
    items: [
      { title: 'زيارات اليوم', val: '1,842', up: true },
      { title: 'مبيعات', val: '234 طلب', up: true },
      { title: 'متوسط الطلب', val: '18.5 د.ك', up: true },
      { title: 'عائد الاستثمار', val: '340%', up: true },
    ],
  },
  {
    id: 'settings',
    label: 'الإعدادات',
    x: 0.50,
    y: 0.88,
    r: 58,
    color: '#94a3b8',
    color2: '#cbd5e1',
    desc: 'إدارة الحساب',
    items: [
      { title: 'اللغة', val: 'العربية', up: true },
      { title: 'الإشعارات', val: 'مفعلة', up: true },
      { title: 'الأمان', val: 'بصمة + وجه', up: true },
      { title: 'الاشتراك', val: 'Pro', up: true },
    ],
  },
];

// Bubble SVG icons (NO emojis!)
const BUBBLE_ICONS: Record<string, string> = {
  ads: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  suggest: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  subchat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M20 12v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/><path d="M18 12h2"/>',
  analytics: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};

// ------------------------------------------------------------------
//  Inline components for MagneticEdge + SnapPreview
// ------------------------------------------------------------------

function MagneticEdge() {
  const [activeEdge, setActiveEdge] = useState<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 40;
      const mx = e.clientX;
      const my = e.clientY;
      const sw = window.innerWidth;
      const sh = window.innerHeight;

      if (mx < threshold) setActiveEdge('left');
      else if (mx > sw - threshold) setActiveEdge('right');
      else if (my < threshold) setActiveEdge('top');
      else setActiveEdge(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  if (!activeEdge) return null;

  const edgeStyles: Record<string, React.CSSProperties> = {
    left: { position: 'fixed', left: 0, top: 0, width: '4px', height: '100vh', background: 'rgba(0,212,255,0.4)', boxShadow: '0 0 20px rgba(0,212,255,0.3)', zIndex: 98, pointerEvents: 'none' },
    right: { position: 'fixed', right: 0, top: 0, width: '4px', height: '100vh', background: 'rgba(0,212,255,0.4)', boxShadow: '0 0 20px rgba(0,212,255,0.3)', zIndex: 98, pointerEvents: 'none' },
    top: { position: 'fixed', left: 0, top: 0, width: '100vw', height: '4px', background: 'rgba(0,212,255,0.4)', boxShadow: '0 0 20px rgba(0,212,255,0.3)', zIndex: 98, pointerEvents: 'none' },
  };

  return <div style={edgeStyles[activeEdge]} />;
}

function SnapPreview() {
  const [snapZone, setSnapZone] = useState<string | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 60;
      const mx = e.clientX;
      const my = e.clientY;
      const sw = window.innerWidth;

      if (mx < threshold) setSnapZone('left');
      else if (mx > sw - threshold) setSnapZone('right');
      else if (my < threshold) setSnapZone('maximize');
      else setSnapZone(null);
    };

    const handleMouseUp = () => setSnapZone(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (!snapZone) return null;

  const zoneStyles: Record<string, React.CSSProperties> = {
    left: { position: 'fixed', left: 0, top: 0, width: '50vw', height: '100vh', background: 'rgba(0,212,255,0.06)', border: '2px dashed rgba(0,212,255,0.3)', zIndex: 99, pointerEvents: 'none', transition: 'all 0.2s ease' },
    right: { position: 'fixed', right: 0, top: 0, width: '50vw', height: '100vh', background: 'rgba(0,212,255,0.06)', border: '2px dashed rgba(0,212,255,0.3)', zIndex: 99, pointerEvents: 'none', transition: 'all 0.2s ease' },
    maximize: { position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh', background: 'rgba(0,212,255,0.04)', border: '2px dashed rgba(0,212,255,0.25)', zIndex: 99, pointerEvents: 'none', transition: 'all 0.2s ease' },
  };

  return <div style={zoneStyles[snapZone]} />;
}

// ------------------------------------------------------------------
//  SideDock (minimized windows)
// ------------------------------------------------------------------

interface SideDockItem {
  id: string;
  title: string;
  iconSvg: string;
  iconColor: string;
  iconColor2: string;
}

interface SideDockProps {
  items: SideDockItem[];
  onRestore: (id: string) => void;
  hidden: boolean;
}

function SideDock({ items, onRestore, hidden }: SideDockProps) {
  if (hidden) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 150,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px 6px',
        borderRadius: '18px',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        background: 'rgba(0, 0, 20, 0.7)',
        border: '1px solid rgba(0, 212, 255, 0.2)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        maxHeight: '70vh',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onRestore(item.id)}
          title={item.title}
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            border: '1px solid rgba(0, 212, 255, 0.15)',
            background: 'rgba(0, 212, 255, 0.06)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: '6px 4px',
            gap: '4px',
            transition: 'all 0.25s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 212, 255, 0.18)';
            e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.4)';
            e.currentTarget.style.boxShadow = '0 0 16px rgba(0, 212, 255, 0.25)';
            e.currentTarget.style.transform = 'scale(1.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 212, 255, 0.06)';
            e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.15)';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '8px',
              background: `linear-gradient(135deg, ${item.iconColor}, ${item.iconColor2})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              dangerouslySetInnerHTML={{ __html: item.iconSvg }}
            />
          </div>
          <span
            style={{
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '7px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '50px',
              textAlign: 'center',
              lineHeight: 1.2,
            }}
          >
            {item.title}
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
//  Main Home Component
// ------------------------------------------------------------------

export default function Home() {
  // ---- Convert normalized bubble defs to BubbleData for BubbleCanvas ----
  const [screenSize, setScreenSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  });

  useEffect(() => {
    const handleResize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Convert 0-1 normalized positions to pixel positions for BubbleCanvas
  const bubbleDataForCanvas: BubbleData[] = useMemo(() => {
    return BUBBLE_DEFS.map((b) => ({
      id: b.id,
      label: b.label,
      x: b.x * screenSize.width,
      y: b.y * screenSize.height,
      r: b.r,
      color: b.color,
      color2: b.color2,
      desc: b.desc,
      items: b.items,
    }));
  }, [screenSize]);

  // ---- Window state ----
  const [openWindows, setOpenWindows] = useState<OpenWindow[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const nextParticleIdRef = useRef(1);

  // ---- Bubble hint tooltip ----
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  // ---- Get cascade position for new windows ----
  const getCascadePosition = useCallback(() => {
    const offset = (NEXT_WINDOW_ID % 6) * 40;
    return {
      x: Math.min(100 + offset, screenSize.width - DEFAULT_WINDOW_WIDTH - 40),
      y: Math.min(60 + offset, screenSize.height - DEFAULT_WINDOW_HEIGHT - 40),
    };
  }, [screenSize]);

  // ---- 1. handleBubbleClick: open window from bubble ----
  const handleBubbleClick = useCallback(
    (bubble: BubbleData, screenX: number, screenY: number) => {
      // Check if window for this bubble already exists
      const existing = openWindows.find(
        (w) => w.bubbleId === bubble.id && w.state !== 'minimized'
      );
      if (existing) {
        // Bring to front instead of duplicating
        handleWindowActivate(existing.id);
        return;
      }

      const { x, y } = getCascadePosition();
      const bubbleDef = BUBBLE_DEFS.find((b) => b.id === bubble.id);
      if (!bubbleDef) return;

      const newWindow: OpenWindow = {
        id: `win-${NEXT_WINDOW_ID++}`,
        bubbleId: bubble.id,
        title: bubbleDef.label,
        subtitle: bubbleDef.desc,
        iconSvg: BUBBLE_ICONS[bubble.id] || BUBBLE_ICONS.settings,
        iconColor: bubbleDef.color,
        iconColor2: bubbleDef.color2,
        items: bubbleDef.items,
        footerText: `آخر تحديث: ${new Date().toLocaleTimeString('ar-SA')}`,
        state: 'normal',
        zIndex: NEXT_Z_INDEX++,
        x,
        y,
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      };

      setOpenWindows((prev) => [...prev, newWindow]);
    },
    [openWindows, getCascadePosition]
  );

  // ---- 2. handleBubblePop: create pop particles ----
  const handleBubblePop = useCallback(
    (x: number, y: number, color: string) => {
      const newParticles: Particle[] = [];
      const count = 16;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 40 + Math.random() * 100;
        newParticles.push({
          id: nextParticleIdRef.current++,
          x,
          y,
          tx: Math.cos(angle) * speed,
          ty: Math.sin(angle) * speed - 20,
          color,
          size: 3 + Math.random() * 5,
          duration: 0.6 + Math.random() * 0.5,
        });
      }

      setParticles((prev) => [...prev, ...newParticles]);

      // Clean up particles after animation
      setTimeout(() => {
        setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
      }, 1200);
    },
    []
  );

  // ---- 3a. handleWindowMinimize ----
  const handleWindowMinimize = useCallback((id: string) => {
    setOpenWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        return { ...w, state: 'minimized', prevState: w.state };
      })
    );
  }, []);

  // ---- 3b. handleWindowMaximize ----
  const handleWindowMaximize = useCallback((id: string) => {
    setOpenWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        if (w.state === 'maximized') {
          // Restore to normal
          return {
            ...w,
            state: 'normal',
            prevState: undefined,
            zIndex: NEXT_Z_INDEX++,
          };
        }
        // Maximize
        return {
          ...w,
          state: 'maximized',
          prevState: w.state,
          zIndex: NEXT_Z_INDEX++,
        };
      })
    );
  }, []);

  // ---- 3c. handleWindowClose ----
  const handleWindowClose = useCallback((id: string) => {
    setOpenWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  // ---- 4. handleWindowRestore: restore minimized window ----
  const handleWindowRestore = useCallback((id: string) => {
    setOpenWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const restoredState = (w.prevState as OpenWindow['state']) || 'normal';
        return {
          ...w,
          state: restoredState === 'minimized' ? 'normal' : restoredState,
          prevState: undefined,
          zIndex: NEXT_Z_INDEX++,
        };
      })
    );
  }, []);

  // ---- 5. handleWindowActivate: bring to front ----
  const handleWindowActivate = useCallback((id: string) => {
    setOpenWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, zIndex: NEXT_Z_INDEX++ } : w
      )
    );
  }, []);

  // ---- 6. handleWindowPosition: update position ----
  const handleWindowPosition = useCallback(
    (id: string, newX: number, newY: number) => {
      setOpenWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, x: newX, y: newY } : w))
      );
    },
    []
  );

  // ---- 7. handleWindowSize: update size ----
  const handleWindowSize = useCallback(
    (id: string, newWidth: number, newHeight: number) => {
      setOpenWindows((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, width: newWidth, height: newHeight } : w
        )
      );
    },
    []
  );

  // ---- 8. handleWindowSnap: snap to left/right/maximize ----
  const handleWindowSnap = useCallback(
    (id: string, zone: 'left' | 'right' | 'maximize') => {
      setOpenWindows((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w;
          const newState =
            zone === 'left'
              ? 'snapped-left'
              : zone === 'right'
                ? 'snapped-right'
                : 'maximized';
          return { ...w, state: newState, zIndex: NEXT_Z_INDEX++ };
        })
      );
    },
    []
  );

  // ---- Build minimized items for SideDock ----
  const minimizedItems: SideDockItem[] = useMemo(() => {
    return openWindows
      .filter((w) => w.state === 'minimized')
      .map((w) => ({
        id: w.id,
        title: w.title,
        iconSvg: w.iconSvg,
        iconColor: w.iconColor,
        iconColor2: w.iconColor2,
      }));
  }, [openWindows]);

  // ---- Build WindowState[] for WindowDock compatibility ----
  const minimizedWindowStates: WindowState[] = useMemo(() => {
    return openWindows
      .filter((w) => w.state === 'minimized')
      .map((w) => ({
        id: w.id,
        title: w.title,
        content: null,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        zIndex: w.zIndex,
        isMinimized: true,
        isMaximized: w.state === 'maximized',
      }));
  }, [openWindows]);

  // ---- Visible windows (not minimized) ----
  const visibleWindows = useMemo(
    () => openWindows.filter((w) => w.state !== 'minimized'),
    [openWindows]
  );



  // ---- Main render ----
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#000',
        direction: 'rtl',
      }}
    >
      {/* ===== z-index 0: Deep space background ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <SpaceCanvas />
      </div>

      {/* ===== z-index 15: Soap bubble physics canvas ===== */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 15,
        }}
      >
        <BubbleCanvas
          bubbles={bubbleDataForCanvas}
          onBubbleClick={handleBubbleClick}
          onBubblePop={handleBubblePop}
        />
      </div>

      {/* ===== z-index 20: Floating title "جاسم" ===== */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 20,
          pointerEvents: 'none',
        }}
      >
        <FloatingTitle />
      </div>

      {/* ===== z-index 10: Main chat (always visible) ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto' }}>
          <MainChat />
        </div>
      </div>

      {/* ===== z-index 98: Magnetic edge snap indicators ===== */}
      <MagneticEdge />

      {/* ===== z-index 99: Snap zone preview ===== */}
      <SnapPreview />

      {/* ===== z-index 100: SoapWindow(s) ===== */}
      {visibleWindows.map((w) => (
        <div
          key={w.id}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            zIndex: w.zIndex,
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto' }}>
            <SoapWindow
              id={w.id}
              title={w.title}
              subtitle={w.subtitle}
              iconSvg={w.iconSvg}
              iconColor={w.iconColor}
              iconColor2={w.iconColor2}
              items={w.items}
              footerText={w.footerText}
              state={w.state}
              zIndex={w.zIndex}
              defaultX={w.x}
              defaultY={w.y}
              defaultWidth={w.width}
              defaultHeight={w.height}
              onMinimize={() => handleWindowMinimize(w.id)}
              onMaximize={() => handleWindowMaximize(w.id)}
              onClose={() => handleWindowClose(w.id)}
              onActivate={() => handleWindowActivate(w.id)}
              onPositionChange={(nx, ny) => handleWindowPosition(w.id, nx, ny)}
              onSizeChange={(nw, nh) => handleWindowSize(w.id, nw, nh)}
              onSnap={(zone) => handleWindowSnap(w.id, zone)}
            />
          </div>
        </div>
      ))}

      {/* ===== z-index 150: SideDock (minimized windows) ===== */}
      <SideDock
        items={minimizedItems}
        onRestore={handleWindowRestore}
        hidden={minimizedItems.length === 0}
      />

      {/* ===== z-index 200: PopParticles (bubble pop effects) ===== */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none' }}>
        <PopParticles particles={particles} />
      </div>

      {/* ===== Bubble hint tooltip ===== */}
      {showHint && (
        <div
          id="bubbleHint"
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 250,
            padding: '8px 18px',
            borderRadius: '20px',
            background: 'rgba(0, 0, 20, 0.8)',
            border: '1px solid rgba(0, 212, 255, 0.25)',
            color: 'rgba(255, 255, 255, 0.75)',
            fontSize: '12px',
            fontFamily: "'Noto Sans Arabic', sans-serif",
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            pointerEvents: 'none',
            animation: 'fadeInUp 0.5s ease, fadeOut 0.5s ease 5.5s forwards',
            whiteSpace: 'nowrap',
          }}
        >
          اضغط مطولاً لفقع الفقاعة
        </div>
      )}
    </div>
  );
}
