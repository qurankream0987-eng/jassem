import type { BubbleSchema, DnaProfile, SchemaType, SchemaTheme, SchemaTrust, SchemaAction } from './types';

export function generateBubbleSchema(type: SchemaType, data: Record<string, unknown>, profile: DnaProfile): BubbleSchema {
  const theme = generateTheme(profile);
  const trust = generateTrust(profile);
  const actions = generateActions(type);

  return {
    id: `schema-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    title: data.title as string ?? 'Untitled',
    subtitle: data.subtitle as string,
    data,
    layout: {
      columns: type === 'dashboard' ? 3 : type === 'comparison' ? 2 : 1,
      gap: 16,
      padding: 24,
      rtl: true,
      responsive: true,
    },
    theme,
    trust,
    actions,
  };
}

export function generateComparisonSchema(items: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('comparison', { items, title: 'Comparison', subtitle: 'Compare options' }, profile);
}

export function generateFormSchema(fields: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('form', { fields, title: 'Form', subtitle: 'Fill in details' }, profile);
}

export function generateGallerySchema(images: string[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('gallery', { images, title: 'Gallery', subtitle: 'Browse images' }, profile);
}

export function generateMapSchema(locations: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('map', { locations, title: 'Map', subtitle: 'View locations' }, profile);
}

export function generateChatSchema(messages: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('chat', { messages, title: 'Chat', subtitle: 'Conversation' }, profile);
}

export function generateDashboardSchema(widgets: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('dashboard', { widgets, title: 'Dashboard', subtitle: 'Overview' }, profile);
}

export function generateTimelineSchema(events: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('timeline', { events, title: 'Timeline', subtitle: 'Track progress' }, profile);
}

export function generateListSchema(items: Record<string, unknown>[], profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('list', { items, title: 'List', subtitle: 'Browse items' }, profile);
}

export function generateCardSchema(item: Record<string, unknown>, profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('card', { ...item, title: item.title as string ?? 'Card' }, profile);
}

export function generateProgressSchema(value: number, maxValue: number, profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('progress', { value, maxValue, title: 'Progress', subtitle: `${value}/${maxValue}` }, profile);
}

export function generateConfirmationSchema(message: string, profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('confirmation', { message, title: 'Confirm', subtitle: 'Please confirm' }, profile);
}

export function generateNotificationSchema(message: string, priority: 'low' | 'medium' | 'high' | 'urgent', profile: DnaProfile): BubbleSchema {
  return generateBubbleSchema('notification', { message, priority, title: 'Notification', subtitle: message }, profile);
}

export function applyTheme(schema: BubbleSchema, theme: Partial<SchemaTheme>): BubbleSchema {
  return {
    ...schema,
    theme: { ...schema.theme, ...theme },
  };
}

function generateTheme(profile: DnaProfile): SchemaTheme {
  const ui = profile.genes.ui ?? 0.5;
  const hue = Math.floor(ui * 360);
  return {
    primary: `hsl(${hue}, 70%, 50%)`,
    secondary: `hsl(${(hue + 30) % 360}, 70%, 45%)`,
    background: `hsl(${hue}, 20%, 95%)`,
    surface: `hsl(${hue}, 20%, 100%)`,
    text: `hsl(${hue}, 20%, 15%)`,
    accent: `hsl(${(hue + 180) % 360}, 70%, 50%)`,
    gradient: `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue + 60) % 360}, 70%, 45%))`,
    glassmorphism: true,
  };
}

function generateTrust(profile: DnaProfile): SchemaTrust {
  const trust = profile.genes.trust ?? 0.5;
  const level = trust > 0.8 ? 'diamond' : trust > 0.6 ? 'gold' : trust > 0.4 ? 'silver' : 'bronze';
  return {
    score: Math.floor(trust * 100),
    level,
    verified: trust > 0.5,
    escrow: trust > 0.6,
    insurance: trust > 0.8,
  };
}

function generateActions(type: SchemaType): SchemaAction[] {
  const baseActions: SchemaAction[] = [
    { id: 'primary', label: 'Confirm', type: 'primary', handler: 'confirm', disabled: false },
    { id: 'secondary', label: 'Cancel', type: 'secondary', handler: 'cancel', disabled: false },
  ];

  switch (type) {
    case 'form':
      return [
        { id: 'submit', label: 'Submit', type: 'primary', handler: 'submit', disabled: false },
        { id: 'reset', label: 'Reset', type: 'secondary', handler: 'reset', disabled: false },
      ];
    case 'comparison':
      return [
        { id: 'select', label: 'Select', type: 'primary', handler: 'select', disabled: false },
        { id: 'compare', label: 'Compare', type: 'secondary', handler: 'compare', disabled: false },
      ];
    case 'confirmation':
      return [
        { id: 'yes', label: 'Yes', type: 'primary', handler: 'confirm', disabled: false },
        { id: 'no', label: 'No', type: 'danger', handler: 'cancel', disabled: false },
      ];
    case 'notification':
      return [
        { id: 'dismiss', label: 'Dismiss', type: 'ghost', handler: 'dismiss', disabled: false },
        { id: 'view', label: 'View', type: 'primary', handler: 'view', disabled: false },
      ];
    default:
      return baseActions;
  }
}
