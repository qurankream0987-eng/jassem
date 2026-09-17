import type {
  PresentationDefinition,
  PresentationPrimitive,
} from '@workspace/jasim-runtime-contract';

export type MobilePresentationPolicy =
  | 'INLINE'
  | 'BOTTOM_SHEET'
  | 'EXPANDED'
  | 'FULL_SCREEN_TEMPORARY';

export type MobilePresentationRendererKind =
  | 'text'
  | 'entity'
  | 'collection'
  | 'comparison'
  | 'form'
  | 'choice'
  | 'approval'
  | 'status'
  | 'timeline'
  | 'document'
  | 'map'
  | 'state';

/**
 * The native registry contains semantic renderers only. Runtime data may
 * select a primitive, but it cannot select a component, import, or handler.
 */
export const MOBILE_PRESENTATION_REGISTRY: Partial<
  Record<PresentationPrimitive, MobilePresentationRendererKind>
> = {
  TEXT: 'text',
  CARD: 'entity',
  ENTITY_CARD: 'entity',
  LIST: 'collection',
  ENTITY_LIST: 'collection',
  ENTITY_GRID: 'collection',
  SEARCH_RESULTS: 'collection',
  GRID: 'collection',
  DETAIL: 'entity',
  FORM: 'form',
  CHOICE: 'choice',
  COMPARISON: 'comparison',
  STATUS: 'status',
  PROGRESS: 'status',
  PAYMENT_STATUS: 'status',
  TIMELINE: 'timeline',
  TRACKER: 'timeline',
  // Spatial primitives share one semantic renderer. MARKER and ROUTE are the
  // parts a MAP is built from, so a projection that sends either on its own
  // still renders rather than falling through to "unsupported".
  MAP: 'map',
  MARKER: 'map',
  ROUTE: 'map',
  CALENDAR: 'timeline',
  SCHEDULE: 'timeline',
  APPROVAL: 'approval',
  ACTION: 'approval',
  CHECKOUT: 'approval',
  PRICE_SUMMARY: 'approval',
  DOCUMENT: 'document',
  WARNING: 'state',
  ERROR_STATE: 'state',
  EMPTY_STATE: 'state',
  RECEIPT: 'document',
  WORLD_SUMMARY: 'entity',
};

export function resolveMobilePresentationPolicy(
  presentation: PresentationDefinition,
): MobilePresentationPolicy {
  switch (presentation.primitive) {
    case 'FORM':
    case 'CHOICE':
    case 'APPROVAL':
    case 'ACTION':
    case 'CHECKOUT':
      return 'BOTTOM_SHEET';
    case 'DOCUMENT':
    case 'COMPARISON':
      return 'EXPANDED';
    case 'MEDIA':
    case 'ARTIFACT_PREVIEW':
      return 'FULL_SCREEN_TEMPORARY';
    default:
      return 'INLINE';
  }
}