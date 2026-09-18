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
  /**
   * A default heading to suppress on this surface.
   *
   * A TRACKER's first child is also a TRACKER, so both took the same default
   * title and the answer read «التتبّع» twice, one under the other. A child
   * whose heading would only repeat its parent's says nothing by having one.
   */
  suppressTitle?: string;
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


/**
 * Arabic titles per primitive. JASIM is Arabic-first, and the previous fallback
 * was the literal English string "JASIM presentation" — which appeared as the
 * heading of every generated surface, including error states.
 *
 * `null` means the surface carries no heading at all. A single sentence of
 * conversation does not need a title bar announcing that it is a presentation;
 * Part 24 asks for calm, and the calmest thing a chrome element can do is not
 * exist.
 */
const PRIMITIVE_TITLE_AR: Partial<Record<PresentationPrimitive, string | null>> = {
  TEXT: null,
  SMART_BUBBLE: null,
  SEARCH_RESULTS: 'النتائج',
  ENTITY_LIST: 'العناصر',
  LIST: 'العناصر',
  ENTITY_GRID: 'العناصر',
  GRID: 'العناصر',
  COMPARISON: 'مقارنة',
  CHOICE: 'اختر واحدًا',
  FORM: 'بيانات مطلوبة',
  APPROVAL: 'موافقة مطلوبة',
  CHECKOUT: 'تأكيد مالي',
  STATUS: 'الحالة',
  PROGRESS: 'التقدّم',
  TRACKER: 'التتبّع',
  MAP: 'الموقع',
  TIMELINE: 'المسار الزمني',
  DOCUMENT: 'مستند',
  RECEIPT: 'إيصال',
  ERROR_STATE: 'تعذّر إكمال الطلب',
  EMPTY_STATE: 'لا توجد نتائج',
  WARNING: 'تنبيه',
};

/**
 * Primitives that state a problem. They must never be decorated with a
 * success-coloured trust badge.
 *
 * The previous renderer hardcoded `trust: { level: 'verified', verified: true }`
 * for EVERY presentation, so a "المزود غير متاح" surface shipped with a green
 * "Verified" chip beside it. Nothing about that was true — the presentation
 * contract was valid, which is not the same claim as the content being
 * verified — and it is exactly the failure Part 19 names: a blocked state
 * wearing a success colour.
 */
const NON_AFFIRMATIVE_PRIMITIVES = new Set<PresentationPrimitive>([
  'ERROR_STATE',
  'EMPTY_STATE',
  'WARNING',
]);

/**
 * The decision layer emits a bounded, already-authorized option set as
 * `data.candidates`; the choice renderer reads `data.options`. Nothing bridged
 * the two, so every CHOICE surface rendered an empty list with a lone button —
 * the ambiguity-to-CHOICE flow proved at the runtime level in Wave 1.2 was
 * invisible on the web.
 *
 * Only the fields needed to pick are carried across. A candidate's other
 * fields, whatever they are, stay out of the option label.
 */
function choiceOptions(data: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const candidates = data.candidates;
  if (!Array.isArray(candidates)) return undefined;
  return candidates.map((candidate, index) => {
    const record = (candidate ?? {}) as Record<string, unknown>;
    const reference =
      typeof record.referenceKey === 'string'
        ? record.referenceKey
        : typeof record.entityRef === 'string'
          ? record.entityRef
          : String(index + 1);
    const label =
      typeof record.title === 'string' && record.title.trim()
        ? record.title
        : typeof record.label === 'string' && record.label.trim()
          ? record.label
          : reference;
    return { id: reference, value: reference, label, ordinal: index + 1 };
  });
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
    title:
      definition.title ||
      (definition.primitive in PRIMITIVE_TITLE_AR
        ? (PRIMITIVE_TITLE_AR[definition.primitive] ?? '')
        : ''),
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
      ...(definition.primitive === 'CHOICE' && !Array.isArray(definition.data.options)
        ? (() => {
            const options = choiceOptions(definition.data);
            return options ? { options } : {};
          })()
        : {}),
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
    trust: NON_AFFIRMATIVE_PRIMITIVES.has(definition.primitive)
      ? {
          // The contract was valid; the outcome was not a success. Only the
          // former is something the renderer is entitled to assert, and
          // `none` is the contract's word for "no claim made".
          level: 'none' as const,
          verified: false,
          badges: ['runtime-presentation'],
        }
      : {
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
  suppressTitle,
}: PresentationRendererProps) {
  const parsed = safeParsePresentationDefinition(presentation);
  if (!parsed.success) {
    return (
      <div
        data-testid="presentation-blocked"
        data-blocked-reason="invalid-contract"
        className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
      >
        تعذّر عرض هذا السطح: عقد التشغيل الخاص به غير صالح.
      </div>
    );
  }

  const schema = toBubbleSchema(parsed.data as PresentationDefinition);
  if (schema && suppressTitle && schema.title === suppressTitle && !parsed.data.title) {
    schema.title = '';
  }
  if (!schema) {
    return (
      <div
        data-testid="presentation-blocked"
        data-blocked-reason="unsupported-primitive"
        className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
      >
        هذا النوع من الأسطح غير مدعوم في هذا العارض بعد.
      </div>
    );
  }

  const children = parsed.data.children ?? [];
  return (
    <div className="mt-3">
      <SchemaRenderer
        schema={schema}
        onAction={(actionId) => onAction?.(actionId)}
        onSubmit={onSubmit}
        /*
          UI-2: a child is part of its parent's answer, not a second answer.
          A TRACKER with a MAP child used to render as two — on mobile, three —
          separately bordered, separately blurred, separately badged glass panes
          stacked down the screen for what is a single tracking surface. Nesting
          the children inside the parent's body is what makes "one strong
          primary surface" (Part 24) true rather than aspirational.
        */
        nested={children.length > 0 ? (
          <div className="jasim-surface-children">
            {children.map((child, index) => (
              <PresentationRenderer
                key={`${schema.id}-child-${index}`}
                presentation={child}
                onAction={onAction}
                onSubmit={onSubmit}
                suppressTitle={schema.title}
              />
            ))}
          </div>
        ) : undefined}
      />
    </div>
  );
}