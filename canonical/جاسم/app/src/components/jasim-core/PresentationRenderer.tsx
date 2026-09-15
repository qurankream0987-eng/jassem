import type { BubbleSchema } from '@contracts/jasim';
import {
  type PresentationDefinition,
  type PresentationPrimitive,
} from '@/lib/presentation-contract';
import { safeParsePresentationDefinition } from '@/lib/presentation-contract';
import { SchemaRenderer } from './SchemaRenderer';

export interface PresentationRendererProps {
  presentation: unknown;
  onAction?: (intent: string) => void;
  onSubmit?: (data: Record<string, unknown>, schema: BubbleSchema) => void | Promise<void>;
}

/**
 * The only presentation-to-component mapping. Values are trusted local
 * registry entries; provider and model output never supplies a component name.
 */
export const TRUSTED_PRESENTATION_REGISTRY: Record<
  PresentationPrimitive,
  BubbleSchema['type'] | null
> = {
  TEXT: 'text',
  CARD: 'card',
  ENTITY_CARD: 'entity_card',
  LIST: 'entity_list',
  ENTITY_LIST: 'entity_list',
  ENTITY_GRID: 'entity_grid',
  SEARCH_RESULTS: 'entity_list',
  GRID: 'entity_grid',
  DETAIL: 'detail',
  FORM: 'form',
  CHOICE: 'choice',
  TABLE: 'table',
  COMPARISON: 'comparison',
  STATUS: 'status',
  PROGRESS: 'progress',
  TIMELINE: 'timeline',
  TRACKER: 'tracker',
  MAP: 'map',
  MARKER: 'map',
  ROUTE: 'map',
  CALENDAR: 'timeline',
  SCHEDULE: 'timeline',
  ACTION: 'confirmation',
  APPROVAL: 'approval',
  CHECKOUT: 'checkout',
  PRICE_SUMMARY: 'checkout',
  EXTERNAL_ACTION: 'confirmation',
  PAYMENT_STATUS: 'status',
  CHAT: 'chat',
  METRIC: 'dashboard',
  ARTIFACT_PREVIEW: 'gallery',
  DOCUMENT: 'document',
  MEDIA: 'media',
  WARNING: 'warning',
  RECEIPT: 'receipt',
  WORLD_SUMMARY: 'detail',
  WORKSPACE: null,
  ERROR_STATE: 'error_state',
  EMPTY_STATE: 'empty_state',
  SMART_BUBBLE: 'card',
};

function primitiveToBubbleType(
  primitive: PresentationDefinition['primitive'],
): BubbleSchema['type'] | null {
  return TRUSTED_PRESENTATION_REGISTRY[primitive];
}

function toBubbleSchema(definition: PresentationDefinition): BubbleSchema | null {
  const type = primitiveToBubbleType(definition.primitive);
  if (!type) return null;
  const fields = definition.fields?.map((field) => ({
    name: field.name,
    label: field.label || field.name,
    type:
      field.type === 'array'
        ? 'multiselect'
        : field.type === 'boolean'
          ? 'checkbox'
          : field.type === 'number'
            ? 'number'
            : field.type === 'object'
              ? 'textarea'
              : 'text',
    required: field.requiredNow,
    readOnly: field.readOnly,
    description: field.unknown ? 'This value is not yet verified.' : undefined,
  }));
  return {
    id: `presentation-${definition.version}-${definition.primitive.toLowerCase()}`,
    type,
    title: definition.title || 'JASIM presentation',
    layout: { width: 'full', compact: false, rtl: true },
    theme: {
      background: 'transparent',
      text: '#f8fafc',
      dark: true,
      glassmorphism: true,
      rtl: true,
    },
    data: {
      ...definition.data,
      ...(fields ? { fields } : {}),
    },
    actions: (definition.actions ?? []).map((action) => ({
      id: action.intent,
      label: action.label,
      type:
        action.intent === 'cancel' || action.intent === 'reject'
          ? 'cancel'
          : action.intent === 'open' || action.intent === 'open_external'
            ? 'link'
            : 'custom',
      requiresApproval: action.requiresApproval,
      metadata: action.external ? { external: true } : undefined,
    })),
    trust: {
      level: 'verified',
      verified: true,
      badges: ['runtime-presentation'],
    },
    version: `presentation:${definition.version}`,
  };
}

/**
 * The runtime sends an unknown value across the message boundary. It must be
 * validated again at the renderer boundary before any component is selected.
 * Invalid definitions render a blocked state and never reach a dynamic
 * component resolver.
 */
export function PresentationRenderer({
  presentation,
  onAction,
  onSubmit,
}: PresentationRendererProps) {
  const parsed = safeParsePresentationDefinition(presentation);
  if (!parsed.success) {
    return (
      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        This presentation was blocked because its runtime contract was invalid.
      </div>
    );
  }

  const schema = toBubbleSchema(parsed.data as PresentationDefinition);
  if (!schema) {
    return (
      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        This presentation type is not supported by the renderer.
      </div>
    );
  }

  return (
    <div className="mt-3">
      <SchemaRenderer
        schema={schema}
        onAction={(actionId) => onAction?.(actionId)}
        onSubmit={onSubmit}
      />
      {parsed.data.children?.map((child, index) => (
        <PresentationRenderer
          key={`${schema.id}-child-${index}`}
          presentation={child}
          onAction={onAction}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}