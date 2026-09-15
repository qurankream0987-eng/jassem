import React, { useMemo } from 'react';
import type {
  SmartBubbleAction,
  SmartBubbleRuntimeRecord,
} from '@workspace/jasim-bubble-contract';
import type { BubbleSchema } from '@contracts/jasim';
import { RuntimeBubbleRenderer } from './RuntimeBubbleRenderer';

export interface RuntimeBubbleLayerProps {
  bubbles: SmartBubbleRuntimeRecord[];
  onPresentationAction: (
    bubbleId: string,
    actionId: SmartBubbleAction['id'],
  ) => void;
  onSubmit?: (
    bubble: SmartBubbleRuntimeRecord,
    data: Record<string, unknown>,
    schema: BubbleSchema,
  ) => void | Promise<void>;
}

export const RuntimeBubbleLayer: React.FC<RuntimeBubbleLayerProps> = ({
  bubbles,
  onPresentationAction,
  onSubmit,
}) => {
  const { archivedBubbles, compactBubbles, expandedBubbles, fullScreenBubbles } = useMemo(() => {
    const activeBubbles = bubbles.filter((bubble) => bubble.status === 'active');
    return {
      archivedBubbles: bubbles.filter((bubble) => bubble.status === 'archived'),
      compactBubbles: activeBubbles.filter(
        (bubble) => bubble.presentation.surface === 'compact',
      ),
      expandedBubbles: activeBubbles.filter(
        (bubble) => bubble.presentation.surface === 'expanded',
      ),
      fullScreenBubbles: activeBubbles.filter(
        (bubble) => bubble.presentation.surface === 'full_screen',
      ),
    };
  }, [bubbles]);

  return (
    <div className="absolute inset-0 z-40 overflow-hidden pointer-events-none" dir="rtl">
      {expandedBubbles.length > 0 ? (
        <div className="absolute inset-0 flex flex-wrap content-start justify-start gap-6 p-6 pb-32 overflow-y-auto pointer-events-auto">
          {expandedBubbles.map((bubble) => (
            <div
              key={bubble.bubbleId}
              className="w-full max-w-xl transition-all duration-500 ease-out animate-in fade-in slide-in-from-bottom-4"
            >
              <RuntimeBubbleRenderer
                bubble={bubble}
                onPresentationAction={onPresentationAction}
                onSubmit={onSubmit}
                className="max-h-[70vh]"
              />
            </div>
          ))}
        </div>
      ) : null}

      {fullScreenBubbles.length > 0 ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md pointer-events-auto animate-in fade-in duration-300">
          {fullScreenBubbles.map((bubble) => (
            <div
              key={bubble.bubbleId}
              className="w-full h-full max-w-6xl transition-all duration-500 animate-in zoom-in-95 fade-in"
            >
              <RuntimeBubbleRenderer
                bubble={bubble}
                onPresentationAction={onPresentationAction}
                onSubmit={onSubmit}
              />
            </div>
          ))}
        </div>
      ) : null}

      {archivedBubbles.length > 0 ? (
        <div className="absolute bottom-8 left-8 z-50 flex max-w-xs flex-col gap-2 p-3 border rounded-2xl bg-slate-950/90 backdrop-blur-2xl border-white/10 shadow-2xl pointer-events-auto">
          <p className="px-1 text-[11px] font-medium text-slate-500">الأسطح المؤرشفة</p>
          {archivedBubbles.map((bubble) => {
            const restoreAction = bubble.availableActions.find(
              (action) => action.id === 'restore' && action.enabled,
            );
            return (
              <div key={bubble.bubbleId} className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-300 truncate">{bubble.title}</span>
                {restoreAction ? (
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-teal-200 bg-teal-500/10 hover:bg-teal-500/20 transition-colors"
                    onClick={() => onPresentationAction(bubble.bubbleId, restoreAction.id)}
                  >
                    {restoreAction.label}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {compactBubbles.length > 0 ? (
        <div className="absolute bottom-8 left-1/2 z-50 flex items-center gap-3 p-3 -translate-x-1/2 border rounded-2xl bg-slate-900/90 backdrop-blur-2xl border-white/10 shadow-2xl ring-1 ring-white/5 pointer-events-auto animate-in slide-in-from-bottom-8">
          {compactBubbles.map((bubble) => {
            const isError = bubble.presentation.contentStatus === 'error';
            const isLoading = bubble.presentation.contentStatus === 'loading';
            const expandAction = bubble.availableActions.find(
              (action) => action.id === 'restore' || action.id === 'expand',
            );
            return (
              <button
                key={bubble.bubbleId}
                type="button"
                onClick={() => {
                  if (expandAction) {
                    onPresentationAction(bubble.bubbleId, expandAction.id);
                  }
                }}
                className="flex items-center gap-3.5 px-4 py-2.5 rounded-xl border border-white/5 bg-slate-800/40 hover:bg-teal-500/10 hover:border-teal-500/30 transition-all duration-300 group"
              >
                <span className="relative flex items-center justify-center w-2.5 h-2.5">
                  {isLoading ? (
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
                  ) : (
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isError
                          ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                          : 'bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.6)]'
                      }`}
                    />
                  )}
                </span>
                <span className="flex flex-col items-start">
                  <span className="text-sm font-semibold tracking-wide text-slate-300 group-hover:text-teal-100 transition-colors">
                    {bubble.title}
                  </span>
                  {isLoading ? (
                    <span className="mt-0.5 text-[10px] font-medium text-teal-400/80">
                      قيد المعالجة...
                    </span>
                  ) : null}
                  {isError ? (
                    <span className="mt-0.5 text-[10px] font-medium text-rose-400/80">
                      خطأ في السطح
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};