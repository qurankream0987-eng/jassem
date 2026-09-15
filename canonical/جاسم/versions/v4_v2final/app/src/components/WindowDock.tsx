import type { WindowState } from "@/context/WindowContext";

interface WindowDockProps {
  minimizedWindows: WindowState[];
  onRestore: (id: string) => void;
}

export default function WindowDock({
  minimizedWindows,
  onRestore,
}: WindowDockProps) {
  if (minimizedWindows.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: "16px",
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px 8px",
        borderRadius: "16px",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        background: "rgba(0, 0, 20, 0.7)",
        border: "1px solid rgba(0, 212, 255, 0.2)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        maxHeight: "70vh",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {minimizedWindows.map((win) => (
        <button
          key={win.id}
          onClick={() => onRestore(win.id)}
          title={win.title}
          style={{
            width: "60px",
            height: "60px",
            borderRadius: "14px",
            border: "1px solid rgba(0, 212, 255, 0.15)",
            background: "rgba(0, 212, 255, 0.06)",
            backdropFilter: "blur(10px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: "6px 4px",
            gap: "4px",
            transition: "all 0.25s var(--spring)",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.18)";
            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.4)";
            e.currentTarget.style.boxShadow = "0 0 16px rgba(0, 212, 255, 0.25)";
            e.currentTarget.style.transform = "scale(1.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.06)";
            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.15)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          {/* Window icon */}
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "8px",
              background: "rgba(0, 212, 255, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.9)",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 212, 255, 0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
          </div>
          {/* Window title */}
          <span
            style={{
              color: "rgba(255, 255, 255, 0.7)",
              fontSize: "8px",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "52px",
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            {win.title}
          </span>
        </button>
      ))}
    </div>
  );
}
