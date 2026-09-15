import React from 'react';
import { SchemaRenderer } from './SchemaRenderer';
import { Loader2, AlertCircle, Ban, LayoutGrid, Minus, Maximize2, X, Maximize, RotateCw } from 'lucide-react';
import type {
  SmartBubbleAction,
  SmartBubbleRuntimeRecord,
} from '@workspace/jasim-bubble-contract';
import type { BubbleAction, BubbleSchema } from '@contracts/jasim';
import { BUBBLE_TYPES } from '@contracts/constants';
import { safePresentationPath } from '@workspace/jasim-runtime-contract';

export interface RuntimeBubbleRendererProps {
  bubble: SmartBubbleRuntimeRecord;
  onPresentationAction: (bubbleId: string, actionId: SmartBubbleAction['id']) => void;
  onSubmit?: (
    bubble: SmartBubbleRuntimeRecord,
    data: Record<string, unknown>,
    schema: BubbleSchema,
  ) => void | Promise<void>;
  className?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBubbleActions(value: unknown): BubbleAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string') {
      return [];
    }
    return [{
      id: item.id,
      label: item.label,
      type:
        item.type === 'submit' ||
        item.type === 'cancel' ||
        item.type === 'link' ||
        item.type === 'download' ||
        item.type === 'share' ||
        item.type === 'custom'
          ? item.type
          : 'custom',
      disabled: item.disabled === true,
    }];
  });
}

function safeBubbleType(value: unknown): BubbleSchema['type'] {
  const knownTypes = new Set<string>(Object.values(BUBBLE_TYPES));
  return typeof value === 'string' && knownTypes.has(value)
    ? value as BubbleSchema['type']
    : 'card';
}

function safeArtifactRenderPath(value: unknown): string | null {
  return safePresentationPath(value, '/api/runtime/generated-image/');
}

function schemaForBubble(bubble: SmartBubbleRuntimeRecord): BubbleSchema {
  const source = bubble.content.schema;
  const sourceLayout = isRecord(source.layout) ? source.layout : {};
  const sourceTheme = isRecord(source.theme) ? source.theme : {};
  const sourceTrust = isRecord(source.trust) ? source.trust : {};
  const schemaData = isRecord(source.data) ? source.data : bubble.content.data;
  return {
    id: bubble.bubbleId,
    type: safeBubbleType(source.type),
    title: typeof source.title === 'string' ? source.title : bubble.title,
    subtitle:
      typeof source.subtitle === 'string'
        ? source.subtitle
        : bubble.semanticDescription,
    layout: {
      width: sourceLayout.width as BubbleSchema['layout']['width'],
      height: sourceLayout.height as BubbleSchema['layout']['height'],
      columns: typeof sourceLayout.columns === 'number' ? sourceLayout.columns : undefined,
      compact: sourceLayout.compact === true,
      rtl: true,
    },
    theme: {
      background: 'transparent',
      text: undefined,
      accent: undefined,
      dark: sourceTheme.dark !== false,
      glassmorphism: true,
      rtl: true,
    },
    data: schemaData,
    actions: asBubbleActions(source.actions),
    trust: {
      level:
        sourceTrust.level === 'basic' ||
        sourceTrust.level === 'verified' ||
        sourceTrust.level === 'trusted' ||
        sourceTrust.level === 'system'
          ? sourceTrust.level
          : 'system',
      verified: sourceTrust.verified !== false,
      badges: Array.isArray(sourceTrust.badges)
        ? sourceTrust.badges.filter((badge): badge is string => typeof badge === 'string')
        : ['runtime'],
    },
    version: bubble.version,
  };
}

function bubbleArtifactPreviews(bubble: SmartBubbleRuntimeRecord): Array<{
  id: string;
  role: string;
  renderPath: string;
}> {
  return bubble.references.flatMap((reference) => {
    const renderPath = isRecord(reference) ? safeArtifactRenderPath(reference.renderPath) : null;
    if (
      !isRecord(reference) ||
      reference.kind !== 'runtime_artifact' ||
      typeof reference.artifactId !== 'string' ||
      typeof reference.role !== 'string' ||
      !renderPath
    ) {
      return [];
    }
    return [{
      id: `${reference.sourceRunId ?? 'run'}:${reference.artifactId}:${reference.role}`,
      role: reference.role,
      renderPath,
    }];
  });
}

export const RuntimeBubbleRenderer: React.FC<RuntimeBubbleRendererProps> = ({
  bubble,
  onPresentationAction,
  onSubmit,
  className = ''
}) => {
  const { presentation, availableActions } = bubble;
  const artifacts = bubbleArtifactPreviews(bubble);
  const isRtl = true;

  const renderHeader = () => {
    return (
      <div className={`flex items-center justify-between px-5 py-3.5 border-b border-white/5 bg-slate-900/60 backdrop-blur-xl ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div className={`flex items-center gap-3.5 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <div className="relative flex items-center justify-center w-3 h-3">
            <div className="absolute inset-0 rounded-full bg-teal-400 opacity-20 animate-ping" />
            <div className="w-2 h-2 rounded-full bg-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.8)]" />
          </div>
          <div className="flex flex-col items-end">
            <span className="text-sm font-semibold text-slate-100 tracking-wide" dir="rtl">
              {bubble.title || 'سطح تفاعلي'}
            </span>
            {bubble.semanticDescription && (
              <span className="text-[11px] text-teal-200/60 font-medium mt-0.5" dir="rtl">
                {bubble.semanticDescription}
              </span>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-1 ${isRtl ? 'flex-row-reverse' : ''}`}>
          {availableActions.map(action => {
            if (!action.enabled) return null;
            let Icon = LayoutGrid;
            if (action.id === 'minimize') Icon = Minus;
            if (action.id === 'expand') Icon = Maximize2;
            if (action.id === 'full_screen') Icon = Maximize;
            if (action.id === 'archive') Icon = X;
            if (action.id === 'update') Icon = RotateCw;

            return (
              <button
                key={action.id}
                onClick={() => onPresentationAction(bubble.bubbleId, action.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-teal-300 hover:bg-teal-500/10 transition-all duration-200"
                title={action.label}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (presentation.contentStatus) {
      case 'loading':
        return (
          <div className="flex flex-col items-center justify-center p-16 space-y-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-xl bg-teal-500/20 animate-pulse" />
              <Loader2 className="w-10 h-10 text-teal-400 animate-spin relative z-10" />
            </div>
            <p className="text-sm font-medium text-teal-200/80" dir="rtl">
              {presentation.message || 'جاري معالجة البيانات...'}
            </p>
          </div>
        );
      case 'empty':
        return (
          <div className="flex flex-col items-center justify-center p-16 space-y-5 text-slate-500">
            <div className="p-4 rounded-full bg-slate-800/50 border border-slate-700/50">
              <LayoutGrid className="w-8 h-8 text-slate-400 opacity-50" />
            </div>
            <p className="text-sm font-medium" dir="rtl">
              {presentation.message || 'المساحة فارغة حالياً'}
            </p>
          </div>
        );
      case 'error':
        return (
          <div className="flex flex-col items-center justify-center p-16 space-y-5 text-rose-400/90">
            <div className="p-4 rounded-full bg-rose-500/10 border border-rose-500/20">
              <AlertCircle className="w-8 h-8" />
            </div>
            <p className="text-sm font-medium text-center max-w-xs leading-relaxed" dir="rtl">
              {presentation.message || 'تعذر استرداد معلومات هذا السطح في الوقت الحالي.'}
            </p>
          </div>
        );
      case 'blocked':
        return (
          <div className="flex flex-col items-center justify-center p-16 space-y-5 text-amber-500/90">
            <div className="p-4 rounded-full bg-amber-500/10 border border-amber-500/20">
              <Ban className="w-8 h-8" />
            </div>
            <p className="text-sm font-medium text-center max-w-xs leading-relaxed" dir="rtl">
              {presentation.message || 'هذا السطح مقيد أو غير متاح.'}
            </p>
          </div>
        );
      case 'ready':
      default:
        return (
          <div className="p-4" dir="rtl">
            {artifacts.length > 0 && (
              <div className="mb-4 grid grid-cols-2 gap-3">
                {artifacts.map((artifact) => (
                  <figure key={artifact.id} className="overflow-hidden rounded-xl border border-teal-400/20 bg-slate-900/60">
                    <img
                      src={artifact.renderPath}
                      alt={`Artifact مرتبط بدور ${artifact.role}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <figcaption className="px-2 py-1.5 text-[10px] text-teal-100/70">
                      {artifact.role}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
             <SchemaRenderer
               schema={schemaForBubble(bubble)}
               onSubmit={(data, schema) => onSubmit?.(bubble, data, schema)}
             />
          </div>
        );
    }
  };

  return (
    <div 
      className={`flex flex-col w-full h-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)] bg-slate-950/80 backdrop-blur-2xl ring-1 ring-white/5 ${className}`}
      dir="rtl"
    >
      {renderHeader()}
      <div className="flex-1 overflow-y-auto min-h-[200px] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {renderContent()}
      </div>
    </div>
  );
};
