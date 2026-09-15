import { memo } from "react";
import type { BubbleWindowData } from "./BubbleWindow";

interface BubbleDockProps {
  bubbles: BubbleWindowData[];
  onRestore: (id: string) => void;
}

/** أيقونة الفقاعة حسب النوع */
function getBubbleIcon(type?: string) {
  switch (type) {
    case "product":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 212, 255, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 01-8 0" />
        </svg>
      );
    case "payment":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 212, 255, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "rating":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 215, 0, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "tracking":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 212, 255, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "kycverify":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 200, 150, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "alert":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 107, 0, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "bundle":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(168, 85, 247, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "haggle":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(236, 72, 153, 0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      );
    default:
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 212, 255, 0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <line x1="3" y1="9" x2="21" y2="9" />
        </svg>
      );
  }
}

/** لون خلفية الفقاعة */
function getBubbleColor(type?: string): string {
  switch (type) {
    case "product": return "rgba(0, 212, 255, 0.12)";
    case "payment": return "rgba(0, 200, 150, 0.12)";
    case "rating": return "rgba(255, 215, 0, 0.12)";
    case "tracking": return "rgba(74, 158, 255, 0.12)";
    case "kycverify": return "rgba(0, 200, 150, 0.12)";
    case "alert": return "rgba(255, 107, 0, 0.12)";
    case "bundle": return "rgba(168, 85, 247, 0.12)";
    case "haggle": return "rgba(236, 72, 153, 0.12)";
    default: return "rgba(0, 212, 255, 0.06)";
  }
}

const BubbleDockItem = memo(function BubbleDockItem({
  bubble,
  onRestore,
}: {
  bubble: BubbleWindowData;
  onRestore: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onRestore(bubble.id)}
      title={bubble.title}
      style={{
        width: "60px",
        height: "60px",
        borderRadius: "14px",
        border: "1px solid rgba(0, 212, 255, 0.15)",
        background: getBubbleColor(bubble.bubbleType),
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: "6px 4px",
        gap: "4px",
        transition: "all 0.25s var(--spring)",
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = getBubbleColor(bubble.bubbleType).replace(
          /[\d.]+\)$/,
          "0.25)"
        );
        el.style.borderColor = "rgba(0, 212, 255, 0.4)";
        el.style.boxShadow = "0 0 16px rgba(0, 212, 255, 0.25)";
        el.style.transform = "scale(1.08)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = getBubbleColor(bubble.bubbleType);
        el.style.borderColor = "rgba(0, 212, 255, 0.15)";
        el.style.boxShadow = "none";
        el.style.transform = "scale(1)";
      }}
    >
      {/* شريط لوني علوي صغير */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "20%",
          right: "20%",
          height: "2px",
          background: bubble.bubbleType === "rating"
            ? "rgba(255, 215, 0, 0.5)"
            : "rgba(0, 212, 255, 0.4)",
          borderRadius: "0 0 2px 2px",
        }}
      />

      {/* أيقونة الفقاعة */}
      <div
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "10px",
          background: "rgba(255, 255, 255, 0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {getBubbleIcon(bubble.bubbleType)}
      </div>

      {/* عنوان الفقاعة */}
      <span
        style={{
          color: "rgba(255, 255, 255, 0.65)",
          fontSize: "7px",
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "52px",
          textAlign: "center",
          lineHeight: 1.2,
          direction: "rtl",
        }}
      >
        {bubble.title}
      </span>
    </button>
  );
});

/** ال Dock الرأسي — يعرض الفقاعات المصغرة */
function BubbleDock({ bubbles, onRestore }: BubbleDockProps) {
  const minimizedBubbles = bubbles.filter((b) => b.minimized);

  if (minimizedBubbles.length === 0) return null;

  // أقصى ١٠ عناصر
  const displayBubbles = minimizedBubbles.slice(0, 10);

  return (
    <div
      className="window-dock"
      style={{
        position: "fixed",
        right: "16px",
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px 8px",
        borderRadius: "16px",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        background: "rgba(0, 0, 20, 0.7)",
        border: "1px solid rgba(0, 212, 255, 0.2)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 16px rgba(0, 212, 255, 0.05)",
        maxHeight: "70vh",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {displayBubbles.map((bubble) => (
        <BubbleDockItem
          key={bubble.id}
          bubble={bubble}
          onRestore={onRestore}
        />
      ))}

      {/* مؤشر عدد إضافي */}
      {minimizedBubbles.length > 10 && (
        <div
          style={{
            width: "60px",
            height: "24px",
            borderRadius: "8px",
            border: "1px dashed rgba(0, 212, 255, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(0, 212, 255, 0.5)",
            fontSize: "10px",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          +{minimizedBubbles.length - 10}
        </div>
      )}
    </div>
  );
}

export default memo(BubbleDock);
