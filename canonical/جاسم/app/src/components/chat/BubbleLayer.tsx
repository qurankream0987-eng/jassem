import { useCallback } from 'react';
import { X, Minus, Maximize2 } from 'lucide-react';
import { useWindowContext } from '@/context/WindowContext';
import { SchemaRenderer } from '@/components/jasim-core/SchemaRenderer';
import type { BubbleSchema } from '@contracts/jasim';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FloatingBubble {
  schema: BubbleSchema;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isClosed: boolean;
}

export interface BubbleLayerProps {
  bubbles: FloatingBubble[];
  onCloseBubble: (id: string) => void;
  onMinimizeBubble: (id: string) => void;
  onRestoreBubble: (id: string) => void;
  onBubbleAction?: (actionId: string, schema: BubbleSchema) => void;
}

// ── Individual Floating Bubble Card ──────────────────────────────────────────

function FloatingBubbleCard({
  bubble,
  onClose,
  onMinimize,
  onAction,
}: {
  bubble: FloatingBubble;
  onClose: () => void;
  onMinimize: () => void;
  onAction?: (actionId: string, schema: BubbleSchema) => void;
}) {
  const { openWindow } = useWindowContext();

  const handleExpand = useCallback(() => {
    openWindow(
      bubble.schema.title || 'Bubble',
      <SchemaRenderer
        schema={bubble.schema}
        onAction={(actionId, schema) => onAction?.(actionId, schema)}
      />,
      {
        x: bubble.x,
        y: bubble.y,
        width: Math.max(400, bubble.width),
        height: Math.max(500, bubble.height),
      }
    );
    onClose();
  }, [bubble, openWindow, onAction, onClose]);

  if (bubble.isMinimized || bubble.isClosed) return null;

  return (
    <div
      className="absolute flex flex-col rounded-2xl overflow-hidden border border-slate-700/50 shadow-2xl shadow-black/40"
      style={{
        left: bubble.x,
        top: bubble.y,
        width: bubble.width,
        height: bubble.height,
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(20px)',
        zIndex: 50,
      }}
    >
      {/* Bubble Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 bg-slate-900/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="text-xs font-medium text-slate-300 truncate">
            {bubble.schema.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExpand}
            className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
            title="Expand"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onMinimize}
            className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bubble Content */}
      <div className="flex-1 overflow-auto p-4">
        <SchemaRenderer
          schema={bubble.schema}
          onAction={(actionId, schema) => onAction?.(actionId, schema)}
        />
      </div>
    </div>
  );
}

// ── Minimized Bubble Dock ────────────────────────────────────────────────────

function MinimizedBubbleDock({
  bubbles,
  onRestore,
  onClose,
}: {
  bubbles: FloatingBubble[];
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const minimized = bubbles.filter((b) => b.isMinimized && !b.isClosed);
  if (minimized.length === 0) return null;

  return (
    <div
      className="absolute bottom-4 left-4 flex items-center gap-2"
      style={{ zIndex: 60 }}
    >
      {minimized.map((bubble) => (
        <button
          key={bubble.schema.id}
          onClick={() => onRestore(bubble.schema.id)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/90 border border-slate-700/50 text-xs text-slate-300 hover:bg-slate-700/90 transition group"
        >
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="max-w-[120px] truncate">{bubble.schema.title}</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onClose(bubble.schema.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition"
          >
            <X className="w-3 h-3" />
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function BubbleLayer({
  bubbles,
  onCloseBubble,
  onMinimizeBubble,
  onRestoreBubble,
  onBubbleAction,
}: BubbleLayerProps) {
  return (
    <>
      {bubbles
        .filter((b) => !b.isMinimized && !b.isClosed)
        .map((bubble) => (
          <FloatingBubbleCard
            key={bubble.schema.id}
            bubble={bubble}
            onClose={() => onCloseBubble(bubble.schema.id)}
            onMinimize={() => onMinimizeBubble(bubble.schema.id)}
            onAction={onBubbleAction}
          />
        ))}

      <MinimizedBubbleDock
        bubbles={bubbles}
        onRestore={onRestoreBubble}
        onClose={onCloseBubble}
      />
    </>
  );
}
