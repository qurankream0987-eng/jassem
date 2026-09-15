import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface WindowItem {
  title: string;
  val: string;
  up: boolean;
}

export interface SoapWindowProps {
  id: string;
  title: string;
  subtitle: string;
  iconSvg: string; // raw SVG path content
  iconColor: string;
  iconColor2: string;
  items: WindowItem[];
  footerText: string;
  state: 'normal' | 'maximized' | 'minimized' | 'snapped-left' | 'snapped-right';
  zIndex: number;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onActivate: () => void;
  onPositionChange: (x: number, y: number) => void;
  onSizeChange: (w: number, h: number) => void;
  onSnap?: (zone: 'left' | 'right' | 'maximize') => void;
  defaultX?: number;
  defaultY?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}

/* ------------------------------------------------------------------ */
/*  SVG Icons (no emojis)                                              */
/* ------------------------------------------------------------------ */
const Icons = {
  trendUp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 15l-6-6-6 6" />
    </svg>
  ),
  trendDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  star: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" strokeWidth="1.5">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  starEmpty: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  chatSend: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  wallet: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
    </svg>
  ),
  txSend: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" /><polyline points="5 12 12 5 19 12" />
    </svg>
  ),
  txReceive: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" /><polyline points="19 12 12 19 5 12" />
    </svg>
  ),
  chartBar: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  chartLine: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 8 14 12 10 6 6 10 2 6" />
    </svg>
  ),
  users: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  eye: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  click: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 15l-2 5L9 9l11 4-5 2z" />
    </svg>
  ),
  dollar: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  bell: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  shield: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  palette: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.01 17.461 2 12 2z" />
    </svg>
  ),
  globe: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  database: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  clock: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  person: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  lightning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function getWindowType(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('إعلان') || t.includes('ad')) return 'ads';
  if (t.includes('اقتراح') || t.includes('suggest')) return 'suggest';
  if (t.includes('دردش') || t.includes('chat')) return 'subchat';
  if (t.includes('محفظ') || t.includes('wallet')) return 'wallet';
  if (t.includes('تحليل') || t.includes('analy')) return 'analytics';
  if (t.includes('إعداد') || t.includes('setting')) return 'settings';
  return 'default';
}

function parseVal(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/* ------------------------------------------------------------------ */
/*  Animated Progress Bar                                              */
/* ------------------------------------------------------------------ */
const AnimatedProgress: React.FC<{ percent: number; color?: string; delay?: number }> = ({
  percent,
  color = 'var(--cyan)',
  delay = 0,
}) => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(Math.min(100, Math.max(0, percent))), delay);
    return () => clearTimeout(t);
  }, [percent, delay]);

  return (
    <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
      <div style={{ width: `${width}%`, height: '100%', background: `linear-gradient(90deg, ${color}, var(--blue))`, borderRadius: 4, transition: 'width 1s var(--spring)' }} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Stagger fade-in wrapper                                            */
/* ------------------------------------------------------------------ */
const FadeIn: React.FC<{ delay?: number; children: React.ReactNode; className?: string }> = ({
  delay = 0,
  children,
  className = '',
}) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Toggle Switch                                                      */
/* ------------------------------------------------------------------ */
const Toggle: React.FC<{ defaultOn?: boolean; label: string; delay?: number }> = ({
  defaultOn = false,
  label,
  delay = 0,
}) => {
  const [on, setOn] = useState(defaultOn);
  return (
    <FadeIn delay={delay}>
      <div
        className="sw-item"
        onClick={() => setOn(!on)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      >
        <span className="sw-item-title">{label}</span>
        <div
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            background: on ? 'linear-gradient(135deg, var(--cyan), var(--blue))' : 'rgba(255,255,255,0.1)',
            position: 'relative',
            transition: 'all 0.3s var(--spring)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: 2,
              left: on ? 20 : 2,
              transition: 'left 0.3s var(--spring)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            }}
          />
        </div>
      </div>
    </FadeIn>
  );
};

/* ------------------------------------------------------------------ */
/*  Sparkline Chart (SVG)                                              */
/* ------------------------------------------------------------------ */
const Sparkline: React.FC<{ data: number[]; color?: string; height?: number }> = ({
  data,
  color = 'var(--cyan)',
  height = 40,
}) => {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,${height} ${points.split(' ').join(' ')} ${w},${height}`} fill="url(#sparkGrad)" />
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/*  Content: Ads Dashboard                                             */
/* ------------------------------------------------------------------ */
function AdsContent({ items }: { items: WindowItem[] }) {
  const stats = items.slice(0, 4);
  const campaigns = items.slice(4);

  return (
    <>
      {/* Stats grid */}
      <FadeIn delay={50}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { icon: Icons.eye, label: 'المشاهدات', color: 'var(--cyan)' },
            { icon: Icons.click, label: 'النقرات', color: 'var(--blue)' },
            { icon: Icons.users, label: 'العملاء', color: 'var(--purple)' },
            { icon: Icons.dollar, label: 'التكلفة', color: 'var(--green)' },
          ].map((s, i) => {
            const item = stats[i];
            return (
              <div
                key={i}
                className="sw-item"
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 6,
                  padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: s.color }}>
                  {s.icon}
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>{s.label}</span>
                </div>
                <span className="sw-item-title" style={{ fontSize: 18, fontWeight: 700 }}>
                  {item ? item.val : '0'}
                </span>
                {item && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    {item.up ? Icons.trendUp : Icons.trendDown}
                    <span style={{ color: item.up ? '#22c55e' : '#ef4444' }}>
                      {item.up ? '+' : '-'}{Math.abs(parseVal(item.val) * 0.12).toFixed(1)}%
                    </span>
                  </div>
                )}
                <AnimatedProgress percent={60 + Math.random() * 35} delay={200 + i * 100} />
              </div>
            );
          })}
        </div>
      </FadeIn>

      {/* Campaigns list */}
      {campaigns.map((item, idx) => (
        <FadeIn key={idx} delay={300 + idx * 80}>
          <div className="sw-item">
            <div className="sw-item-info" style={{ flex: 1 }}>
              <span className="sw-item-title">{item.title}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <AnimatedProgress percent={parseVal(item.val) % 100} delay={400 + idx * 80} />
              </div>
            </div>
            <span className="sw-item-arrow">
              {item.up ? Icons.trendUp : Icons.trendDown}
            </span>
          </div>
        </FadeIn>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content: Suggestions                                               */
/* ------------------------------------------------------------------ */
function SuggestionsContent({ items }: { items: WindowItem[] }) {
  return (
    <>
      {items.map((item, idx) => {
        const rating = Math.min(5, Math.max(1, 3 + (item.up ? 1 : -1) + (idx % 3) - 1));
        return (
          <FadeIn key={idx} delay={60 + idx * 90}>
            <div className="sw-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="sw-item-info" style={{ flex: 1 }}>
                  <span className="sw-item-title">{item.title}</span>
                  <span className="sw-item-val">{item.val}</span>
                </div>
                <span className="sw-item-arrow">
                  {item.up ? Icons.trendUp : Icons.trendDown}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i}>{i < rating ? Icons.star : Icons.starEmpty}</span>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text2)', marginRight: 4 }}>
                  {rating.toFixed(1)}
                </span>
                <span style={{ marginRight: 'auto', fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {Icons.clock} {Math.floor(Math.random() * 23 + 1)}h
                </span>
              </div>
              <AnimatedProgress percent={rating * 20} delay={150 + idx * 90} />
            </div>
          </FadeIn>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content: SubChat                                                   */
/* ------------------------------------------------------------------ */
function ChatContent({ items }: { items: WindowItem[] }) {
  const [messages] = useState(() =>
    items.map((item, idx) => ({
      text: item.title,
      time: item.val,
      isMe: idx % 2 === 0,
      idx,
    }))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Chat messages */}
      {messages.map((msg, i) => (
        <FadeIn key={i} delay={80 + i * 100}>
          <div
            style={{
              display: 'flex',
              justifyContent: msg.isMe ? 'flex-start' : 'flex-end',
              animation: `msgIn 0.4s ease ${80 + i * 100}ms both`,
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: msg.isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.isMe
                  ? 'rgba(0,180,255,0.08)'
                  : 'rgba(150,50,255,0.06)',
                border: `1px solid ${msg.isMe ? 'rgba(0,180,255,0.1)' : 'rgba(150,100,255,0.1)'}`,
                backdropFilter: 'blur(12px)',
                fontSize: 13,
                lineHeight: 1.6,
                wordWrap: 'break-word',
                direction: 'rtl',
              }}
            >
              <div style={{ marginBottom: 4 }}>{msg.text}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text2)', justifyContent: 'flex-end' }}>
                {msg.time}
                {!msg.isMe && Icons.check}
              </div>
            </div>
          </div>
        </FadeIn>
      ))}

      {/* Mini composer */}
      <FadeIn delay={messages.length * 100 + 100}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            marginTop: 6,
          }}
        >
          <span style={{ color: 'var(--text2)', fontSize: 11, flex: 1, opacity: 0.5, direction: 'rtl' }}>
            اكتب رسالة...
          </span>
          <div style={{ color: 'var(--cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {Icons.chatSend}
          </div>
        </div>
      </FadeIn>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Content: Wallet                                                    */
/* ------------------------------------------------------------------ */
function WalletContent({ items }: { items: WindowItem[] }) {
  const balance = items[0];
  const transactions = items.slice(1);

  return (
    <>
      {/* Balance card */}
      <FadeIn delay={50}>
        <div
          className="sw-item"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 12,
            padding: '18px 16px',
            background: 'linear-gradient(135deg, rgba(0,180,255,0.08), rgba(100,50,255,0.06)) !important',
            border: '1px solid rgba(0,180,255,0.12) !important',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>الرصيد الحالي</span>
            <span style={{ color: 'var(--cyan)' }}>{Icons.wallet}</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' }}>
            {balance ? balance.val : '$0.00'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            {balance && balance.up ? Icons.trendUp : Icons.trendDown}
            <span style={{ color: balance?.up ? '#22c55e' : '#ef4444' }}>
              {balance?.up ? '+' : '-'}{Math.abs(parseVal(balance?.val || '0') * 0.05).toFixed(2)} (5.2%)
            </span>
            <span style={{ marginRight: 'auto', fontSize: 10, color: 'var(--text2)' }}>هذا الشهر</span>
          </div>
          <AnimatedProgress percent={72} delay={200} />
        </div>
      </FadeIn>

      {/* Section header */}
      <FadeIn delay={200}>
        <div style={{ padding: '10px 4px 4px', fontSize: 11, color: 'var(--text2)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {Icons.clock}
          آخر المعاملات
        </div>
      </FadeIn>

      {/* Transaction list */}
      {transactions.map((item, idx) => (
        <FadeIn key={idx} delay={280 + idx * 80}>
          <div className="sw-item">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: item.up ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.up ? Icons.txReceive : Icons.txSend}
              </div>
              <div className="sw-item-info">
                <span className="sw-item-title">{item.title}</span>
                <span style={{ fontSize: 10, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {Icons.clock} {item.val.includes(':') ? item.val : '14:30'}
                </span>
              </div>
            </div>
            <span
              className="sw-item-val"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: item.up ? '#22c55e' : '#ef4444',
                direction: 'ltr',
              }}
            >
              {item.up ? '+' : '-'}{item.val}
            </span>
          </div>
        </FadeIn>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content: Analytics                                                 */
/* ------------------------------------------------------------------ */
function AnalyticsContent({ items }: { items: WindowItem[] }) {
  // Generate sparkline data from item values
  const sparkData = items.map(i => parseVal(i.val));
  const total = sparkData.reduce((a, b) => a + b, 0);
  const avg = total / (sparkData.length || 1);

  return (
    <>
      {/* Mini chart card */}
      <FadeIn delay={50}>
        <div
          className="sw-item"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 12,
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>إجمالي الأداء</span>
            <span style={{ color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
              {Icons.chartLine} <span style={{ fontSize: 11 }}>مباشر</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 800 }}>{total.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 2 }}>
              {Icons.trendUp} +12.5%
            </span>
          </div>
          <Sparkline data={sparkData.length > 1 ? sparkData : [10, 25, 18, 35, 28, 42, 38, 50, 45, 60]} color="var(--purple)" />
        </div>
      </FadeIn>

      {/* Metric cards row */}
      <FadeIn delay={150}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
          {[
            { label: 'المتوسط', icon: Icons.chartBar, val: avg.toFixed(1), color: 'var(--cyan)' },
            { label: 'القمة', icon: Icons.lightning, val: Math.max(...sparkData, 100).toLocaleString(), color: 'var(--gold)' },
          ].map((m, i) => (
            <div
              key={i}
              className="sw-item"
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '12px 14px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: m.color }}>
                {m.icon}
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{m.label}</span>
              </div>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{m.val}</span>
            </div>
          ))}
        </div>
      </FadeIn>

      {/* Metrics list */}
      {items.map((item, idx) => (
        <FadeIn key={idx} delay={250 + idx * 80}>
          <div className="sw-item">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: `linear-gradient(135deg, rgba(0,180,255,0.1), rgba(100,50,255,0.1))`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--cyan)',
                }}
              >
                {Icons.chartBar}
              </div>
              <div className="sw-item-info" style={{ flex: 1 }}>
                <span className="sw-item-title">{item.title}</span>
                <AnimatedProgress percent={parseVal(item.val) % 100} delay={350 + idx * 80} />
              </div>
            </div>
            <span className="sw-item-val" style={{ fontSize: 14, fontWeight: 700, direction: 'ltr' }}>
              {item.val}
            </span>
            <span className="sw-item-arrow" style={{ marginRight: 8 }}>
              {item.up ? Icons.trendUp : Icons.trendDown}
            </span>
          </div>
        </FadeIn>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content: Settings                                                  */
/* ------------------------------------------------------------------ */
function SettingsContent({ items }: { items: WindowItem[] }) {
  const settingIcons = [Icons.bell, Icons.shield, Icons.palette, Icons.globe, Icons.database, Icons.lightning];
  const settingLabels = items.length > 0
    ? items.map(i => i.title)
    : ['الإشعارات', 'الخصوصية', 'المظهر', 'اللغة', 'النسخ الاحتياطي', 'الأداء'];

  return (
    <>
      {/* Toggles section */}
      {settingLabels.map((label, idx) => (
        <FadeIn key={idx} delay={60 + idx * 70}>
          <div className="sw-item" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'rgba(0,180,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--cyan)',
                flexShrink: 0,
              }}
            >
              {settingIcons[idx % settingIcons.length]}
            </div>
            <span className="sw-item-title" style={{ flex: 1 }}>{label}</span>
            <Toggle defaultOn={idx % 3 !== 1} label="" delay={0} />
          </div>
        </FadeIn>
      ))}

      {/* Info cards */}
      <FadeIn delay={settingLabels.length * 70 + 100}>
        <div
          style={{
            marginTop: 12,
            padding: '14px 16px',
            borderRadius: 16,
            background: 'rgba(0,180,255,0.03)',
            border: '1px solid rgba(0,180,255,0.06)',
            fontSize: 12,
            color: 'var(--text2)',
            lineHeight: 1.8,
            direction: 'rtl',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--cyan)' }}>
            {Icons.shield}
            <span style={{ fontWeight: 600 }}>حالة الحماية</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
            <span>جميع الإعدادات آمنة ومُحدّثة</span>
          </div>
        </div>
      </FadeIn>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Content: Default fallback                                          */
/* ------------------------------------------------------------------ */
function DefaultContent({ items }: { items: WindowItem[] }) {
  return (
    <>
      {items.map((item, idx) => (
        <FadeIn key={idx} delay={60 + idx * 70}>
          <div className="sw-item">
            <div className="sw-item-info">
              <span className="sw-item-title">{item.title}</span>
              <span
                className="sw-item-val"
                style={{ color: item.up ? '#22c55e' : '#ef4444' }}
              >
                {item.val}
              </span>
            </div>
            <span className="sw-item-arrow">
              {item.up ? Icons.trendUp : Icons.trendDown}
            </span>
            <div className="sw-item-progress" />
          </div>
        </FadeIn>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  RichContent Router                                                 */
/* ------------------------------------------------------------------ */
function RichContent({ type, items }: { type: string; items: WindowItem[] }) {
  switch (type) {
    case 'ads': return <AdsContent items={items} />;
    case 'suggest': return <SuggestionsContent items={items} />;
    case 'subchat': return <ChatContent items={items} />;
    case 'wallet': return <WalletContent items={items} />;
    case 'analytics': return <AnalyticsContent items={items} />;
    case 'settings': return <SettingsContent items={items} />;
    default: return <DefaultContent items={items} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const SNAP_THRESHOLD = 80;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

/* ------------------------------------------------------------------ */
/*  SoapWindow Component                                               */
/* ------------------------------------------------------------------ */
export const SoapWindow: React.FC<SoapWindowProps> = ({
  id,
  title,
  subtitle,
  iconSvg,
  iconColor,
  iconColor2,
  items,
  footerText,
  state,
  zIndex,
  onMinimize,
  onMaximize,
  onClose,
  onActivate,
  onPositionChange,
  onSizeChange,
  onSnap,
  defaultX = 120,
  defaultY = 80,
  defaultWidth = 380,
  defaultHeight = 480,
}) => {
  /* ---- local position / size (used when state === 'normal') ---- */
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });

  /* ---- drag state ---- */
  const [isDragging, setIsDragging] = useState(false);
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragVelocity = useRef({ x: 0, y: 0 });
  const lastMousePos = useRef({ x: 0, y: 0 });
  const velocityTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- resize state ---- */
  const [isResizing, setIsResizing] = useState(false);
  const resizeDir = useRef<string>('');
  const resizeStartMouse = useRef({ x: 0, y: 0 });
  const resizeStartSize = useRef({ w: 0, h: 0 });
  const resizeStartPos = useRef({ x: 0, y: 0 });

  /* ---- refs ---- */
  const windowRef = useRef<HTMLDivElement>(null);

  /* ---- compute current display rect ---- */
  const isMaximized = state === 'maximized';
  const isSnappedLeft = state === 'snapped-left';
  const isSnappedRight = state === 'snapped-right';
  const isDocked = isMaximized || isSnappedLeft || isSnappedRight;

  const displayX = isDocked ? 0 : pos.x;
  const displayY = isDocked ? 0 : pos.y;
  const displayW = isDocked
    ? isMaximized
      ? window.innerWidth
      : window.innerWidth / 2
    : size.w;
  const displayH = isDocked ? window.innerHeight : size.h;

  /* ---- velocity tracking ---- */
  const startVelocityTracking = useCallback(() => {
    lastMousePos.current = { x: dragStartMouse.current.x, y: dragStartMouse.current.y };
    if (velocityTimer.current) clearInterval(velocityTimer.current);
    velocityTimer.current = setInterval(() => {
      // velocity is computed during mousemove; this is a placeholder interval
    }, 16);
  }, []);

  const stopVelocityTracking = useCallback(() => {
    if (velocityTimer.current) {
      clearInterval(velocityTimer.current);
      velocityTimer.current = null;
    }
  }, []);

  /* ---- drag start ---- */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // ignore if clicking a control button
      if ((e.target as HTMLElement).closest('.sw-btn')) return;

      e.preventDefault();
      setIsDragging(true);
      dragStartMouse.current = { x: e.clientX, y: e.clientY };
      dragStartPos.current = { ...pos };
      dragVelocity.current = { x: 0, y: 0 };
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      startVelocityTracking();
      onActivate();
    },
    [pos, onActivate, startVelocityTracking]
  );

  /* ---- touch drag start ---- */
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest('.sw-btn')) return;
      const touch = e.touches[0];
      setIsDragging(true);
      dragStartMouse.current = { x: touch.clientX, y: touch.clientY };
      dragStartPos.current = { ...pos };
      dragVelocity.current = { x: 0, y: 0 };
      lastMousePos.current = { x: touch.clientX, y: touch.clientY };
      onActivate();
    },
    [pos, onActivate]
  );

  /* ---- drag move (global) ---- */
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartMouse.current.x;
      const dy = e.clientY - dragStartMouse.current.y;

      // velocity
      const dt = 1;
      dragVelocity.current = {
        x: (e.clientX - lastMousePos.current.x) / dt,
        y: (e.clientY - lastMousePos.current.y) / dt,
      };
      lastMousePos.current = { x: e.clientX, y: e.clientY };

      let newX = dragStartPos.current.x + dx;
      let newY = dragStartPos.current.y + dy;

      // if coming out of snapped/maximized state
      if (isDocked) {
        newX = e.clientX - displayW / 2;
        newY = e.clientY - 20;
        dragStartMouse.current = { x: e.clientX, y: e.clientY };
        dragStartPos.current = { x: newX, y: newY };
      }

      setPos({ x: newX, y: newY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartMouse.current.x;
      const dy = touch.clientY - dragStartMouse.current.y;

      dragVelocity.current = {
        x: touch.clientX - lastMousePos.current.x,
        y: touch.clientY - lastMousePos.current.y,
      };
      lastMousePos.current = { x: touch.clientX, y: touch.clientY };

      let newX = dragStartPos.current.x + dx;
      let newY = dragStartPos.current.y + dy;

      if (isDocked) {
        newX = touch.clientX - displayW / 2;
        newY = touch.clientY - 20;
        dragStartMouse.current = { x: touch.clientX, y: touch.clientY };
        dragStartPos.current = { x: newX, y: newY };
      }

      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      stopVelocityTracking();

      // Snap detection
      const mx = e.clientX;
      const my = e.clientY;
      const sw = window.innerWidth;

      let snapped = false;

      // Left edge snap
      if (mx < SNAP_THRESHOLD) {
        onSnap?.('left');
        snapped = true;
      }
      // Right edge snap
      else if (mx > sw - SNAP_THRESHOLD) {
        onSnap?.('right');
        snapped = true;
      }
      // Top edge snap (maximize)
      else if (my < SNAP_THRESHOLD) {
        onSnap?.('maximize');
        snapped = true;
      }

      if (!snapped) {
        // Velocity-based throw
        const vx = dragVelocity.current.x;
        const vy = dragVelocity.current.y;
        const throwFactor = 0.3;

        let finalX = pos.x + vx * throwFactor;
        let finalY = pos.y + vy * throwFactor;

        // Keep within viewport
        finalX = Math.max(-displayW * 0.7, Math.min(sw - displayW * 0.3, finalX));
        finalY = Math.max(0, Math.min(window.innerHeight - 60, finalY));

        setPos({ x: finalX, y: finalY });
        onPositionChange(finalX, finalY);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      stopVelocityTracking();
      onPositionChange(pos.x, pos.y);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    isDragging,
    isDocked,
    displayW,
    displayH,
    pos,
    onSnap,
    onPositionChange,
    stopVelocityTracking,
  ]);

  /* ---- resize start ---- */
  const handleResizeStart = useCallback(
    (dir: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeDir.current = dir;
      resizeStartMouse.current = { x: e.clientX, y: e.clientY };
      resizeStartSize.current = { ...size };
      resizeStartPos.current = { ...pos };
      onActivate();
    },
    [size, pos, onActivate]
  );

  /* ---- resize move (global) ---- */
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStartMouse.current.x;
      const dy = e.clientY - resizeStartMouse.current.y;
      const dir = resizeDir.current;

      let newW = resizeStartSize.current.w;
      let newH = resizeStartSize.current.h;
      let newX = resizeStartPos.current.x;
      let newY = resizeStartPos.current.y;

      if (dir.includes('e')) newW = Math.max(MIN_WIDTH, resizeStartSize.current.w + dx);
      if (dir.includes('w')) {
        const candidateW = Math.max(MIN_WIDTH, resizeStartSize.current.w - dx);
        newX = resizeStartPos.current.x + (resizeStartSize.current.w - candidateW);
        newW = candidateW;
      }
      if (dir.includes('s')) newH = Math.max(MIN_HEIGHT, resizeStartSize.current.h + dy);
      if (dir.includes('n')) {
        const candidateH = Math.max(MIN_HEIGHT, resizeStartSize.current.h - dy);
        newY = resizeStartPos.current.y + (resizeStartSize.current.h - candidateH);
        newH = candidateH;
      }

      setSize({ w: newW, h: newH });
      if (dir.includes('w') || dir.includes('n')) {
        setPos({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      onSizeChange(size.w, size.h);
      if (resizeDir.current.includes('w') || resizeDir.current.includes('n')) {
        onPositionChange(pos.x, pos.y);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, size, pos, onSizeChange, onPositionChange]);

  /* ---- cursor style based on drag/resize ---- */
  const getCursor = useCallback(() => {
    if (isDragging) return 'grabbing';
    return 'default';
  }, [isDragging]);

  /* ---- don't render if minimized ---- */
  if (state === 'minimized') return null;

  /* ---- derive window type for rich content ---- */
  const windowType = getWindowType(title);

  /* ---- dynamic styles ---- */
  const windowStyle: React.CSSProperties = {
    position: 'absolute',
    left: displayX,
    top: displayY,
    width: displayW,
    height: displayH,
    zIndex,
    cursor: getCursor(),
    touchAction: 'none',
  };

  return (
    <div
      ref={windowRef}
      className={`soap-window state-${state}${isDragging ? ' dragging' : ''}`}
      style={windowStyle}
      onMouseDown={onActivate}
      data-id={id}
    >
      <div className="sw-inner">
        {/* Glass background layer */}
        <div className="liquid-glass-bg" />

        {/* ---- Header ---- */}
        <div
          className="sw-header"
          onMouseDown={handleDragStart}
          onTouchStart={handleTouchStart}
          role="button"
          tabIndex={0}
        >
          {/* Icon circle */}
          <div
            className="sw-icon"
            style={{
              background: `linear-gradient(135deg, ${iconColor}, ${iconColor2})`,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
          </div>

          {/* Title group */}
          <div className="sw-title-group">
            <div className="sw-title">{title}</div>
            <div className="sw-subtitle">{subtitle}</div>
          </div>

          {/* Window controls */}
          <div className="sw-controls">
            <button
              className="sw-btn minimize"
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              title="تصغير"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="3" />
              </svg>
            </button>
            <button
              className="sw-btn maximize"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              title="تكبير"
            >
              {state === 'maximized' ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="5" y="9" width="10" height="10" rx="1" />
                  <path d="M9 9V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                </svg>
              )}
            </button>
            <button
              className="sw-btn close"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="إغلاق"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ---- Rich Content ---- */}
        <div className="sw-content">
          <RichContent type={windowType} items={items} />
        </div>

        {/* ---- Footer ---- */}
        {footerText && <div className="sw-footer">{footerText}</div>}

        {/* ---- Resize Handles (only in normal state) ---- */}
        {state === 'normal' && (
          <>
            <div
              className="resize-handle n"
              onMouseDown={handleResizeStart('n')}
              style={{ position: 'absolute', top: -4, left: 16, right: 16, height: 8, cursor: 'n-resize' }}
            />
            <div
              className="resize-handle s"
              onMouseDown={handleResizeStart('s')}
              style={{ position: 'absolute', bottom: -4, left: 16, right: 16, height: 8, cursor: 's-resize' }}
            />
            <div
              className="resize-handle e"
              onMouseDown={handleResizeStart('e')}
              style={{ position: 'absolute', top: 16, right: -4, bottom: 16, width: 8, cursor: 'e-resize' }}
            />
            <div
              className="resize-handle w"
              onMouseDown={handleResizeStart('w')}
              style={{ position: 'absolute', top: 16, left: -4, bottom: 16, width: 8, cursor: 'w-resize' }}
            />
            <div
              className="resize-handle ne"
              onMouseDown={handleResizeStart('ne')}
              style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, cursor: 'ne-resize' }}
            />
            <div
              className="resize-handle nw"
              onMouseDown={handleResizeStart('nw')}
              style={{ position: 'absolute', top: -4, left: -4, width: 16, height: 16, cursor: 'nw-resize' }}
            />
            <div
              className="resize-handle se"
              onMouseDown={handleResizeStart('se')}
              style={{ position: 'absolute', bottom: -4, right: -4, width: 16, height: 16, cursor: 'se-resize' }}
            />
            <div
              className="resize-handle sw"
              onMouseDown={handleResizeStart('sw')}
              style={{ position: 'absolute', bottom: -4, left: -4, width: 16, height: 16, cursor: 'sw-resize' }}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default SoapWindow;
