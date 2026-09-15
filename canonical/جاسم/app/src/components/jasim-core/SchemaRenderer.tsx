import React, { useState, useCallback, useMemo } from 'react';
import type { BubbleSchema } from '@contracts/jasim';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Loader2, ChevronLeft, ChevronRight, Check, Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SchemaRendererProps {
  schema: BubbleSchema;
  onAction?: (actionId: string, schema: BubbleSchema) => void;
  onSubmit?: (data: Record<string, unknown>, schema: BubbleSchema) => void | Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

interface FieldSchema {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    message?: string;
  };
  description?: string;
  readOnly?: boolean;
}

interface FormErrors {
  [key: string]: string;
}

const SAFE_THEME_COLORS = new Set([
  '#0f172a',
  '#111827',
  '#1e293b',
  '#334155',
  '#475569',
  '#64748b',
  '#94a3b8',
  '#c084fc',
  '#f8fafc',
  '#ffffff',
  '#14b8a6',
  '#38bdf8',
  '#60a5fa',
  '#fbbf24',
  '#fdba74',
  '#f87171',
  'transparent',
]);

export function safeThemeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_THEME_COLORS.has(value.toLowerCase())
    ? value
    : fallback;
}

function safeGridColumns(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4
    ? value
    : fallback;
}

// ── Main Component ───────────────────────────────────────────────────────────

export const SchemaRenderer: React.FC<SchemaRendererProps> = ({
  schema,
  onAction,
  onSubmit,
  isLoading = false,
  error = null,
}) => {
  const renderContent = () => {
    if (isLoading) return renderLoading();
    if (error) return renderError(error);

    switch (schema.type) {
      case 'text':
        return renderText(schema);
      case 'entity_card':
        return renderEntityCard((schema.data.entity as Record<string, unknown>) ?? schema.data);
      case 'entity_list':
        return renderEntityCollection(schema, false, onAction);
      case 'entity_grid':
        return renderEntityCollection(schema, true, onAction);
      case 'detail':
        return renderDetail(schema);
      case 'choice':
        return renderChoice(schema, onAction);
      case 'comparison':
        return renderComparison(schema);
      case 'form':
        return renderForm(schema, onSubmit);
      case 'table':
        return renderTable(schema);
      case 'search':
        return renderSearch(schema);
      case 'filter':
        return renderFilter(schema);
      case 'wizard':
        return renderWizard(schema, onAction);
      case 'gallery':
        return renderGallery(schema);
      case 'map':
        return renderMap(schema);
      case 'chat':
        return renderChat(schema);
      case 'dashboard':
        return renderDashboard(schema);
      case 'status':
        return renderStatus(schema);
      case 'tracker':
        return renderTracker(schema);
      case 'timeline':
        return renderTimeline(schema);
      case 'list':
        return renderList(schema);
      case 'card':
        return renderCard(schema);
      case 'progress':
        return renderProgress(schema);
      case 'confirmation':
        return renderConfirmation(schema);
      case 'approval':
        return renderApproval(schema);
      case 'checkout':
        return renderCheckout(schema);
      case 'document':
        return renderDocument(schema);
      case 'media':
        return renderMedia(schema);
      case 'warning':
        return renderWarning(schema);
      case 'error_state':
        return renderStateMessage(schema, 'error');
      case 'empty_state':
        return renderStateMessage(schema, 'empty');
      case 'receipt':
        return renderReceipt(schema);
      case 'notification':
        return renderNotification(schema);
      default:
        return renderCard(schema);
    }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden border border-white/10"
      style={{
        background: schema.theme?.glassmorphism
          ? 'rgba(255,255,255,0.05)'
          : safeThemeColor(schema.theme?.background, '#0f172a'),
        backdropFilter: schema.theme?.glassmorphism ? 'blur(20px)' : 'none',
        direction: schema.layout?.rtl ? 'rtl' : 'ltr',
      }}
    >
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold" style={{ color: safeThemeColor(schema.theme?.text, '#f8fafc') }}>
              {schema.title}
            </h2>
            {schema.subtitle && (
              <p className="text-sm mt-1" style={{ color: `${safeThemeColor(schema.theme?.text, '#f8fafc')}99` }}>
                {schema.subtitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="px-2 py-1 rounded-full text-xs font-medium"
              style={{
                background: schema.trust.level === 'trusted' || schema.trust.level === 'system'
                  ? 'rgba(147,51,234,0.2)'
                  : schema.trust.level === 'verified'
                  ? 'rgba(148,163,184,0.2)'
                  : 'rgba(180,83,9,0.2)',
                color: schema.trust.level === 'trusted' || schema.trust.level === 'system'
                  ? '#c084fc'
                  : schema.trust.level === 'verified'
                  ? '#94a3b8'
                  : '#fdba74',
              }}
            >
              {schema.trust.level}
            </div>
            {schema.trust.verified && (
              <div className="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-400">
                Verified
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {renderContent()}
        </div>

        {schema.actions && schema.actions.length > 0 && (
          <div className="flex gap-2 mt-6 pt-4 border-t border-white/10">
            {schema.actions.map((action) => (
              <button
                key={action.id}
                onClick={() => onAction?.(action.id, schema)}
                disabled={action.disabled || isLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  action.type === 'custom' || action.type === 'download'
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : action.type === 'cancel'
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : action.type === 'link'
                    ? 'text-slate-400 hover:text-white hover:bg-white/5'
                    : 'bg-white/10 text-white hover:bg-white/20'
                } ${action.disabled || isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isLoading && action.type === 'custom' ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  action.label
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Loading State ────────────────────────────────────────────────────────────

function renderLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-3/4 bg-slate-700" />
      <Skeleton className="h-4 w-1/2 bg-slate-700" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 bg-slate-700 rounded-xl" />
        <Skeleton className="h-24 bg-slate-700 rounded-xl" />
      </div>
      <Skeleton className="h-10 w-full bg-slate-700" />
    </div>
  );
}

// ── Error State ────────────────────────────────────────────────────────────

function renderError(errorMessage: string) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-red-400" />
      </div>
      <h3 className="text-sm font-medium text-red-300 mb-1">Something went wrong</h3>
      <p className="text-xs text-red-400/70 max-w-xs">{errorMessage}</p>
    </div>
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(', ');
  return '';
}

function safeText(value: unknown, fallback = ''): string {
  const text = displayValue(value).trim();
  return text || fallback;
}

function reservedEntityKey(key: string): boolean {
  return new Set([
    'id',
    'ref',
    'entityRef',
    'title',
    'name',
    'label',
    'subtitle',
    'description',
    'summary',
    'image',
    'media',
    'badges',
    'attributes',
    'actions',
    'status',
    'source',
    'provenance',
    'money',
    'availability',
  ]).has(key);
}

function entityAttributes(entity: Record<string, unknown>): Array<[string, string]> {
  const explicit = entity.attributes;
  const pairs =
    explicit && typeof explicit === 'object' && !Array.isArray(explicit)
      ? Object.entries(explicit as Record<string, unknown>)
      : Object.entries(entity).filter(([key]) => !reservedEntityKey(key));
  return pairs
    .map(([key, value]) => [key, displayValue(value)] as [string, string])
    .filter(([, value]) => value.length > 0)
    .slice(0, 12);
}

function renderText(schema: BubbleSchema) {
  return (
    <div className="rounded-xl bg-white/5 p-4">
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
        {safeText(schema.data.text ?? schema.data.body ?? schema.data.summary ?? schema.subtitle)}
      </p>
    </div>
  );
}

function renderEntityCard(entity: Record<string, unknown>) {
  const attributes = entityAttributes(entity);
  const badges = Array.isArray(entity.badges) ? entity.badges : [];
  return (
    <article className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">
            {safeText(entity.title ?? entity.name ?? entity.label, 'Untitled')}
          </h3>
          {safeText(entity.subtitle) && <p className="mt-1 text-xs text-slate-400">{safeText(entity.subtitle)}</p>}
        </div>
        {safeText(entity.status) && <Badge variant="outline">{safeText(entity.status)}</Badge>}
      </div>
      {safeText(entity.description) && <p className="mt-3 text-sm leading-5 text-slate-300">{safeText(entity.description)}</p>}
      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {badges.slice(0, 8).map((badge, index) => (
            <Badge key={`${displayValue(badge)}-${index}`} variant="secondary">{displayValue(badge)}</Badge>
          ))}
        </div>
      )}
      {attributes.length > 0 && (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {attributes.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-black/10 px-3 py-2">
              <dt className="text-[11px] text-slate-500">{key}</dt>
              <dd className="mt-0.5 text-sm text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {safeText(entity.source ?? entity.provenance) && (
        <p className="mt-3 text-[11px] text-slate-500">Source: {safeText(entity.source ?? entity.provenance)}</p>
      )}
    </article>
  );
}

function renderEntityCollection(
  schema: BubbleSchema,
  grid: boolean,
  onAction?: (actionId: string, schema: BubbleSchema) => void,
) {
  const rawItems = schema.data.items ?? schema.data.candidates ?? schema.data.entities;
  const items = Array.isArray(rawItems)
    ? rawItems.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
  return (
    <div className={grid ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'}>
      {items.length === 0 && <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">No results available.</p>}
      {items.map((item, index) => (
        <div key={safeText(item.ref ?? item.entityRef ?? item.id, `entity-${index}`)}>
          {renderEntityCard(item)}
          {Array.isArray(item.actions) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.actions
                .filter((action): action is Record<string, unknown> => Boolean(action && typeof action === 'object'))
                .map((action, actionIndex) => {
                  const ref = safeText(item.ref ?? item.entityRef ?? item.id);
                  const intent = safeText(action.intent, 'select');
                  if (!ref) return null;
                  return (
                    <Button
                      key={`${intent}-${actionIndex}`}
                      type="button"
                      variant="outline"
                      data-action-intent={intent}
                      data-reference={ref}
                      size="sm"
                      onClick={() => onAction?.(`${intent}:${ref}`, schema)}
                    >
                      {safeText(action.label, intent)}
                    </Button>
                  );
                })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function renderDetail(schema: BubbleSchema) {
  const entity =
    schema.data.entity && typeof schema.data.entity === 'object' && !Array.isArray(schema.data.entity)
      ? schema.data.entity as Record<string, unknown>
      : schema.data;
  return renderEntityCard({
    ...entity,
    title: entity.title ?? schema.data.title ?? schema.title,
    description: entity.description ?? entity.summary ?? schema.data.summary ?? schema.data.description,
  });
}

function renderChoice(
  schema: BubbleSchema,
  onAction?: (actionId: string, schema: BubbleSchema) => void,
) {
  const options = Array.isArray(schema.data.options) ? schema.data.options : [];
  return (
    <div className="grid gap-2">
      {options
        .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === 'object'))
        .map((option, index) => {
          const reference = safeText(option.ref ?? option.entityRef ?? option.value);
          if (!reference) return null;
          return (
            <Button
              key={`${reference}-${index}`}
              type="button"
              variant="outline"
              data-action-intent="select"
              data-reference={reference}
              className="justify-between border-white/10 bg-white/5 text-right text-slate-200 hover:bg-white/10"
              onClick={() => onAction?.(`select:${reference}`, schema)}
            >
              <span>{safeText(option.label ?? option.title, `Option ${index + 1}`)}</span>
              <span className="text-xs text-slate-500">{reference}</span>
            </Button>
          );
        })}
    </div>
  );
}

// ── Comparison ───────────────────────────────────────────────────────────────

function renderComparison(schema: BubbleSchema) {
  const rawItems = schema.data.items ?? schema.data.candidates ?? schema.data.entities;
  const items = Array.isArray(rawItems)
    ? rawItems.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
  const columns = safeGridColumns(schema.layout?.columns, Math.max(1, Math.min(items.length, 3)));
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {items.map((item, i) => (
        <div key={i} className="bg-white/5 rounded-xl p-4 hover:bg-white/[0.07] transition">
          <h3 className="text-white font-semibold mb-2">
            {safeText(item.title ?? item.name ?? item.label, `Item ${i + 1}`)}
          </h3>
          <div className="space-y-1">
            {entityAttributes(item).map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-slate-400">{key}</span>
                <span className="text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Form ─────────────────────────────────────────────────────────────────────

function renderForm(
  schema: BubbleSchema,
  onSubmit?: (data: Record<string, unknown>, schema: BubbleSchema) => void | Promise<void>,
) {
  const fields = (schema.data.fields as FieldSchema[]) ?? [];
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    fields.forEach((f) => {
      if (f.defaultValue !== undefined) initial[f.name] = f.defaultValue;
    });
    return initial;
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    fields.forEach((field) => {
      const value = formData[field.name];
      if (field.required && (value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0))) {
        newErrors[field.name] = `${field.label} is required`;
      }
      if (field.validation?.pattern && value) {
        const regex = new RegExp(field.validation.pattern);
        if (!regex.test(String(value))) {
          newErrors[field.name] = field.validation.message || `Invalid ${field.label}`;
        }
      }
      if (field.validation?.minLength && String(value).length < field.validation.minLength) {
        newErrors[field.name] = `Minimum ${field.validation.minLength} characters`;
      }
      if (field.validation?.maxLength && String(value).length > field.validation.maxLength) {
        newErrors[field.name] = `Maximum ${field.validation.maxLength} characters`;
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, fields]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      await onSubmit?.(formData, schema);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, validate, onSubmit]);

  const updateField = useCallback((name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
  }, []);

  const renderField = (field: FieldSchema) => {
    const error = errors[field.name];
    const fieldWrapper = (children: React.ReactNode) => (
      <div key={field.name} className="space-y-1.5">
        <Label className="text-sm text-slate-300 flex items-center gap-1">
          {field.label}
          {field.required && <span className="text-red-400">*</span>}
        </Label>
        {field.description && <p className="text-[11px] text-slate-500">{field.description}</p>}
        {children}
        {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{error}</p>}
      </div>
    );

    switch (field.type) {
      case 'select':
        return fieldWrapper(
          <Select onValueChange={(v) => updateField(field.name, v)} defaultValue={String(field.defaultValue || '')}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm">
              <SelectValue placeholder={field.placeholder || 'Select...'} />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {(field.options || []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-slate-200 focus:bg-slate-700 focus:text-white">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'multiselect':
        return fieldWrapper(
          <div className="flex flex-wrap gap-2">
            {(field.options || []).map((opt) => {
              const selected = ((formData[field.name] as string[]) || []).includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    const current = ((formData[field.name] as string[]) || []);
                    const updated = selected ? current.filter((v) => v !== opt.value) : [...current, opt.value];
                    updateField(field.name, updated);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    selected
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        );
      case 'textarea':
        return fieldWrapper(
          <Textarea
            placeholder={field.placeholder}
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 placeholder-slate-500 text-sm min-h-[80px] focus:border-blue-500/50"
          />
        );
      case 'checkbox':
        return fieldWrapper(
          <div className="flex items-center gap-2">
            <Checkbox
              id={field.name}
              defaultChecked={!!field.defaultValue}
              onCheckedChange={(checked) => updateField(field.name, checked)}
              className="border-slate-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
            />
            <Label htmlFor={field.name} className="text-sm text-slate-400 cursor-pointer">{field.label}</Label>
          </div>
        );
      case 'radio':
        return fieldWrapper(
          <RadioGroup
            defaultValue={String(field.defaultValue || '')}
            onValueChange={(v) => updateField(field.name, v)}
            className="space-y-1"
          >
            {(field.options || []).map((opt) => (
              <div key={opt.value} className="flex items-center gap-2">
                <RadioGroupItem value={opt.value} id={`${field.name}-${opt.value}`} className="border-slate-600 text-blue-500" />
                <Label htmlFor={`${field.name}-${opt.value}`} className="text-sm text-slate-400 cursor-pointer">{opt.label}</Label>
              </div>
            ))}
          </RadioGroup>
        );
      case 'range':
        return fieldWrapper(
          <div className="space-y-2">
            <Slider
              defaultValue={[Number(field.defaultValue) || field.min || 0]}
              min={field.min || 0}
              max={field.max || 100}
              step={field.step || 1}
              onValueChange={([v]) => updateField(field.name, v)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>{field.min || 0}</span>
              <span className="text-slate-300">{String(formData[field.name] ?? field.defaultValue ?? field.min ?? 0)}</span>
              <span>{field.max || 100}</span>
            </div>
          </div>
        );
      case 'color':
        return fieldWrapper(
          <div className="flex items-center gap-3">
            <Input
              type="color"
              defaultValue={String(field.defaultValue || '#3b82f6')}
              onChange={(e) => updateField(field.name, e.target.value)}
              className="w-12 h-10 p-1 bg-slate-800/50 border-slate-700"
            />
            <Input
              type="text"
              defaultValue={String(field.defaultValue || '#3b82f6')}
              onChange={(e) => updateField(field.name, e.target.value)}
              className="flex-1 bg-slate-800/50 border-slate-700 text-slate-200 text-sm"
            />
          </div>
        );
      case 'date':
        return fieldWrapper(
          <Input
            type="date"
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm [color-scheme:dark]"
          />
        );
      case 'time':
        return fieldWrapper(
          <Input
            type="time"
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm [color-scheme:dark]"
          />
        );
      case 'datetime':
        return fieldWrapper(
          <Input
            type="datetime-local"
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm [color-scheme:dark]"
          />
        );
      case 'tel':
        return fieldWrapper(
          <Input
            type="tel"
            placeholder={field.placeholder}
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm focus:border-blue-500/50"
          />
        );
      case 'email':
        return fieldWrapper(
          <Input
            type="email"
            placeholder={field.placeholder}
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm focus:border-blue-500/50"
          />
        );
      case 'number':
        return fieldWrapper(
          <Input
            type="number"
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step}
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, Number(e.target.value))}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm focus:border-blue-500/50"
          />
        );
      case 'file':
        return fieldWrapper(
          <Input
            type="file"
            onChange={(e) => updateField(field.name, e.target.files)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm file:mr-4 file:px-3 file:py-1 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-xs hover:file:bg-blue-500"
          />
        );
      case 'switch':
        return fieldWrapper(
          <div className="flex items-center gap-3">
            <Switch
              id={field.name}
              defaultChecked={!!field.defaultValue}
              onCheckedChange={(checked) => updateField(field.name, checked)}
              className="data-[state=checked]:bg-blue-600"
            />
            <Label htmlFor={field.name} className="text-sm text-slate-400 cursor-pointer">{field.label}</Label>
          </div>
        );
      default:
        // text and fallback
        return fieldWrapper(
          <Input
            type={field.type === 'password' ? 'password' : 'text'}
            placeholder={field.placeholder}
            defaultValue={String(field.defaultValue || '')}
            onChange={(e) => updateField(field.name, e.target.value)}
            className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm focus:border-blue-500/50"
          />
        );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map(renderField)}
      <div className="flex gap-2 pt-2">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-blue-600 hover:bg-blue-500 text-white"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Submit
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => { setFormData({}); setErrors({}); }}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          Reset
        </Button>
      </div>
    </form>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function renderTable(schema: BubbleSchema) {
  const columns = (schema.data.columns as Array<{ key: string; label: string; sortable?: boolean }>) ?? [];
  const rows = (schema.data.rows as Record<string, unknown>[]) ?? [];
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const sortedRows = useMemo(() => {
    let data = [...rows];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      data = data.filter((row) =>
        Object.values(row).some((val) => String(val).toLowerCase().includes(lower))
      );
    }
    if (sortConfig) {
      data.sort((a, b) => {
        const aVal = String(a[sortConfig.key] ?? '');
        const bVal = String(b[sortConfig.key] ?? '');
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return data;
  }, [rows, sortConfig, searchTerm]);

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-8 bg-slate-800/50 border-slate-700 text-slate-200 text-xs"
          />
        </div>
        {searchTerm && (
          <Button variant="ghost" size="sm" onClick={() => setSearchTerm('')} className="h-8 px-2 text-slate-400">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-slate-700/50 overflow-hidden">
        <ScrollArea className="max-h-[400px]">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/80 sticky top-0">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable !== false && handleSort(col.key)}
                    className={`px-3 py-2 text-left text-xs font-medium text-slate-400 ${
                      col.sortable !== false ? 'cursor-pointer hover:text-slate-200 select-none' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {col.sortable !== false && (
                        <span className="text-[10px]">
                          {sortConfig?.key === col.key ? (
                            sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-600" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sortedRows.map((row, i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2 text-slate-300">
                      {String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500 text-xs">
                    No data found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  );
}

// ── Search ───────────────────────────────────────────────────────────────────

function renderSearch(schema: BubbleSchema) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    setIsSearching(true);
    const allItems = (schema.data.items as Record<string, unknown>[]) ?? [];
    const filtered = allItems.filter((item) =>
      Object.values(item).some((val) =>
        String(val).toLowerCase().includes(query.toLowerCase())
      )
    );
    setResults(filtered);
    setIsSearching(false);
  }, [query, schema.data.items]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-9 bg-slate-800/50 border-slate-700 text-slate-200 text-sm"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={isSearching}
          className="bg-blue-600 hover:bg-blue-500"
        >
          {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{results.length} results found</p>
          {results.map((item, i) => (
            <div key={i} className="p-3 rounded-lg bg-white/5 hover:bg-white/10 transition">
              <p className="text-sm text-white font-medium">{String(item.title || item.name || `Result ${i + 1}`)}</p>
              <p className="text-xs text-slate-400">{String(item.description || '')}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter ───────────────────────────────────────────────────────────────────

function renderFilter(schema: BubbleSchema) {
  const filters = (schema.data.filters as Array<{ key: string; label: string; options: string[] }>) ?? [];
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>({});

  const toggleFilter = (key: string, option: string) => {
    setActiveFilters((prev) => {
      const current = prev[key] || [];
      const updated = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [key]: updated };
    });
  };

  const clearFilters = () => setActiveFilters({});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">Filters</span>
        </div>
        {Object.keys(activeFilters).length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-slate-400 hover:text-red-400">
            Clear all
          </Button>
        )}
      </div>

      {filters.map((filter) => (
        <div key={filter.key} className="space-y-2">
          <Label className="text-xs text-slate-400">{filter.label}</Label>
          <div className="flex flex-wrap gap-1.5">
            {filter.options.map((option) => {
              const active = (activeFilters[filter.key] || []).includes(option);
              return (
                <button
                  key={option}
                  onClick={() => toggleFilter(filter.key, option)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    active
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {active && <Check className="w-3 h-3 inline mr-1" />}
                  {option}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {Object.keys(activeFilters).length > 0 && (
        <div className="pt-2 border-t border-slate-800">
          <p className="text-xs text-slate-500">
            Active: {Object.entries(activeFilters).flatMap(([, v]) => v).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

function renderWizard(schema: BubbleSchema, onAction?: (actionId: string, schema: BubbleSchema) => void) {
  const steps = (schema.data.steps as Array<{ title: string; description?: string; fields?: FieldSchema[] }>) ?? [];
  const [currentStep, setCurrentStep] = useState(0);
  const [, setStepData] = useState<Record<string, unknown>[]>([]);
  const [stepErrors, setStepErrors] = useState<FormErrors>({});

  const step = steps[currentStep];
  if (!step) return null;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
      setStepErrors({});
    } else {
      onAction?.('wizard-complete', schema);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      setStepErrors({});
    }
  };

  const updateStepField = (name: string, value: unknown) => {
    setStepData((prev) => {
      const updated = [...prev];
      if (!updated[currentStep]) updated[currentStep] = {};
      updated[currentStep] = { ...updated[currentStep], [name]: value };
      return updated;
    });
    setStepErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
  };

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((_s, i) => (
          <React.Fragment key={i}>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition ${
              i < currentStep ? 'bg-emerald-500/20 text-emerald-400' :
              i === currentStep ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/30' :
              'bg-slate-800 text-slate-500'
            }`}>
              {i < currentStep ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 transition ${i < currentStep ? 'bg-emerald-500/30' : 'bg-slate-800'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step Title */}
      <div>
        <h3 className="text-sm font-semibold text-white">{step.title}</h3>
        {step.description && <p className="text-xs text-slate-400 mt-0.5">{step.description}</p>}
      </div>

      <Separator className="bg-slate-800" />

      {/* Step Fields */}
      {step.fields && (
        <div className="space-y-3">
          {step.fields.map((field) => (
            <div key={field.name} className="space-y-1">
              <Label className="text-xs text-slate-300">{field.label}</Label>
              <Input
                type={field.type}
                placeholder={field.placeholder}
                onChange={(e) => updateStepField(field.name, e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-slate-200 text-sm"
              />
              {stepErrors[field.name] && <p className="text-xs text-red-400">{stepErrors[field.name]}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleBack}
          disabled={currentStep === 0}
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <span className="text-xs text-slate-500">
          Step {currentStep + 1} of {steps.length}
        </span>
        <Button
          size="sm"
          onClick={handleNext}
          className="bg-blue-600 hover:bg-blue-500"
        >
          {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
          {currentStep < steps.length - 1 && <ChevronRight className="w-4 h-4 ml-1" />}
        </Button>
      </div>
    </div>
  );
}

// ── Gallery ────────────────────────────────────────────────────────────────────

function renderGallery(schema: BubbleSchema) {
  const images = Array.isArray(schema.data.images)
    ? schema.data.images
      .map((value) => safeMediaUrl(value))
      .filter((value): value is string => Boolean(value))
    : [];
  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map((img, i) => (
        <div key={i} className="aspect-square rounded-lg bg-white/5 overflow-hidden hover:ring-2 hover:ring-blue-500/30 transition">
          <img src={img} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
        </div>
      ))}
    </div>
  );
}

// ── Map Placeholder ──────────────────────────────────────────────────────────

function renderMap(schema: BubbleSchema) {
  const locations = (schema.data.locations as Record<string, unknown>[]) ?? [];
  return (
    <div className="bg-white/5 rounded-xl p-4 min-h-[200px] flex items-center justify-center">
      <div className="text-center">
        <p className="text-slate-400 text-sm mb-2">Map View</p>
        <div className="space-y-1">
          {locations.map((loc, i) => (
            <p key={i} className="text-white text-sm">{String(loc.name)}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Chat within Bubble ───────────────────────────────────────────────────────

function renderChat(schema: BubbleSchema) {
  const messages = (schema.data.messages as Array<{ isUser: boolean; text: string }>) ?? [];
  return (
    <div className="space-y-2 max-h-[300px] overflow-auto">
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
            msg.isUser ? 'bg-blue-500 text-white' : 'bg-white/10 text-white'
          }`}>
            {msg.text}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function renderDashboard(schema: BubbleSchema) {
  const widgets = (schema.data.widgets as Array<{ label: string; value: string; change?: number }>) ?? [];
  const columns = safeGridColumns(schema.layout?.columns, 2);
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {widgets.map((widget, i) => (
        <div key={i} className="bg-white/5 rounded-xl p-4 hover:bg-white/[0.07] transition">
          <p className="text-slate-400 text-xs mb-1">{widget.label}</p>
          <p className="text-white text-2xl font-bold">{widget.value}</p>
          {widget.change !== undefined && (
            <Badge variant={widget.change >= 0 ? 'default' : 'destructive'} className="mt-1 text-[10px]">
              {widget.change >= 0 ? '+' : ''}{widget.change}%
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

function renderStatus(schema: BubbleSchema) {
  const status = safeText(schema.data.status ?? schema.data.state, 'Status unavailable');
  const summary = safeText(schema.data.summary ?? schema.data.message ?? schema.data.description);
  const updatedAt = safeText(schema.data.updatedAt ?? schema.data.observedAt);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-white">{status}</span>
        {updatedAt && <span className="text-[11px] text-slate-500">{updatedAt}</span>}
      </div>
      {summary && <p className="mt-2 text-sm leading-5 text-slate-300">{summary}</p>}
      {safeText(schema.data.attention) && (
        <p className="mt-3 text-xs text-amber-300">{safeText(schema.data.attention)}</p>
      )}
    </div>
  );
}

function renderTracker(schema: BubbleSchema) {
  return (
    <div className="space-y-3">
      {renderStatus(schema)}
      {safeText(schema.data.locationDescription) && (
        <p className="text-xs text-slate-400">Location: {safeText(schema.data.locationDescription)}</p>
      )}
      {safeText(schema.data.source) && <p className="text-[11px] text-slate-500">Source: {safeText(schema.data.source)}</p>}
    </div>
  );
}

function renderApproval(schema: BubbleSchema) {
  const stateChanges = Array.isArray(schema.data.stateChanges) ? schema.data.stateChanges : [];
  const publicData = Array.isArray(schema.data.publicData) ? schema.data.publicData : [];
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
      <p className="text-sm font-semibold text-amber-100">
        {safeText(schema.data.action ?? schema.data.summary, 'Approval required')}
      </p>
      {safeText(schema.data.target) && <p className="mt-2 text-sm text-slate-300">Target: {safeText(schema.data.target)}</p>}
      {schema.data.amount !== undefined && (
        <p className="mt-2 text-sm text-slate-200">
          Amount: {safeText(schema.data.amount)} {safeText(schema.data.currency)}
        </p>
      )}
      {stateChanges.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-slate-300">
          {stateChanges.map((change, index) => <li key={index}>{displayValue(change)}</li>)}
        </ul>
      )}
      {publicData.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">Visible data: {publicData.map(displayValue).join(', ')}</p>
      )}
      {safeText(schema.data.externalEffect) && (
        <p className="mt-3 text-xs text-amber-200">External effect: {safeText(schema.data.externalEffect)}</p>
      )}
    </div>
  );
}

function renderCheckout(schema: BubbleSchema) {
  const items = Array.isArray(schema.data.items) ? schema.data.items : [];
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
      {items.length > 0 && (
        <div className="space-y-2">
          {items
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
            .map((item, index) => (
              <div key={index} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-300">{safeText(item.title ?? item.name, `Item ${index + 1}`)}</span>
                <span className="text-slate-200">{safeText(item.total ?? item.amount ?? item.price)}</span>
              </div>
            ))}
        </div>
      )}
      <div className="border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-400">Total</span>
          <span className="text-lg font-semibold text-white">
            {safeText(schema.data.total ?? schema.data.amount, 'Not available')} {safeText(schema.data.currency)}
          </span>
        </div>
        {safeText(schema.data.paymentState) && (
          <p className="mt-2 text-xs text-slate-500">Payment state: {safeText(schema.data.paymentState)}</p>
        )}
      </div>
    </div>
  );
}

function renderDocument(schema: BubbleSchema) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="font-semibold text-white">{safeText(schema.data.title ?? schema.title, 'Document')}</h3>
      {safeText(schema.data.summary) && <p className="mt-2 text-sm leading-6 text-slate-300">{safeText(schema.data.summary)}</p>}
      {safeText(schema.data.source) && <p className="mt-3 text-[11px] text-slate-500">Source: {safeText(schema.data.source)}</p>}
    </article>
  );
}

export function safeMediaUrl(value: unknown): string | null {
  const url = safeText(value);
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+=*$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function renderMedia(schema: BubbleSchema) {
  const mediaUrl = safeMediaUrl(schema.data.url ?? schema.data.src ?? schema.data.image);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {mediaUrl && <img src={mediaUrl} alt={safeText(schema.data.alt ?? schema.title, 'Media')} className="max-h-80 w-full rounded-lg object-contain" />}
      {!mediaUrl && <p className="text-sm text-slate-300">{safeText(schema.data.summary ?? schema.data.description, 'Media reference unavailable.')}</p>}
    </div>
  );
}

function renderWarning(schema: BubbleSchema) {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
      <p className="text-sm text-amber-100">{safeText(schema.data.message ?? schema.data.summary, 'Please review this information.')}</p>
    </div>
  );
}

function renderStateMessage(schema: BubbleSchema, kind: 'error' | 'empty') {
  const message = safeText(
    schema.data.message ?? schema.data.summary ?? schema.data.description,
    kind === 'error' ? 'This result could not be displayed.' : 'No results available.',
  );
  return (
    <div className={`rounded-xl border p-4 ${kind === 'error' ? 'border-red-400/20 bg-red-400/10' : 'border-white/10 bg-white/5'}`}>
      <p className={`text-sm ${kind === 'error' ? 'text-red-100' : 'text-slate-300'}`}>{message}</p>
    </div>
  );
}

function renderReceipt(schema: BubbleSchema) {
  return (
    <article className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
      <h3 className="font-semibold text-white">{safeText(schema.data.title ?? schema.title, 'Receipt')}</h3>
      {safeText(schema.data.summary) && <p className="mt-2 text-sm text-slate-300">{safeText(schema.data.summary)}</p>}
      {schema.data.total !== undefined && (
        <p className="mt-3 text-sm text-emerald-100">Total: {safeText(schema.data.total)} {safeText(schema.data.currency)}</p>
      )}
    </article>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────────

function renderTimeline(schema: BubbleSchema) {
  const rawEvents = schema.data.events;
  const events = Array.isArray(rawEvents)
    ? rawEvents.filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object'))
    : [];
  return (
    <div className="space-y-4">
      {events.map((evt, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-3 h-3 rounded-full ${
              evt.state === 'completed' || evt.status === 'completed' ? 'bg-emerald-500' :
              evt.state === 'current' || evt.status === 'current' ? 'bg-blue-500' :
              'bg-slate-600'
            }`} />
            {i < events.length - 1 && <div className="w-0.5 flex-1 bg-white/10 my-1" />}
          </div>
          <div className="pb-4">
            <p className="text-white text-sm font-medium">
              {safeText(evt.title ?? evt.semantics ?? evt.label, 'Event')}
            </p>
            {safeText(evt.at) && <p className="text-[11px] text-slate-500">{safeText(evt.at)}</p>}
            {safeText(evt.description) && <p className="text-slate-400 text-xs">{safeText(evt.description)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function renderList(schema: BubbleSchema) {
  const items = (schema.data.items as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition cursor-pointer">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white text-xs">
            {String(item.icon || '•')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm truncate">{String(item.title || item.name || `Item ${i + 1}`)}</p>
            <p className="text-slate-400 text-xs truncate">{String(item.description || '')}</p>
          </div>
          <span className="text-slate-400 text-sm flex-shrink-0">{String(item.value || '')}</span>
        </div>
      ))}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function renderCard(schema: BubbleSchema) {
  return (
    <div className="bg-white/5 rounded-xl p-4">
      <h3 className="text-white font-semibold mb-2">{String(schema.data.title || schema.title)}</h3>
      <p className="text-slate-400 text-sm">{String(schema.data.body || schema.data.description || schema.subtitle || '')}</p>
    </div>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────

function renderProgress(schema: BubbleSchema) {
  const value = Number(schema.data.value);
  const maxValue = Number(schema.data.maxValue);
  const hasProgress = Number.isFinite(value) && Number.isFinite(maxValue) && maxValue > 0;
  const pct = hasProgress ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : null;
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-white">{safeText(schema.data.label ?? (hasProgress ? `${value} / ${maxValue}` : schema.data.status), 'Processing')}</span>
        {pct !== null && <span className="text-slate-400">{pct.toFixed(1)}%</span>}
      </div>
      {pct !== null && (
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Confirmation ─────────────────────────────────────────────────────────────

function renderConfirmation(schema: BubbleSchema) {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
        <Check className="w-6 h-6 text-blue-400" />
      </div>
      <p className="text-white text-lg mb-4">{String(schema.data.message || 'Are you sure?')}</p>
    </div>
  );
}

// ── Notification ─────────────────────────────────────────────────────────────

function renderNotification(schema: BubbleSchema) {
  const priority = String(schema.data.priority || 'medium');
  const configs: Record<string, { bg: string; border: string }> = {
    urgent: { bg: 'bg-red-500/10', border: 'border-red-500/20' },
    high: { bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    medium: { bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    low: { bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  };
  const config = configs[priority] || configs.medium;
  return (
    <div className={`p-4 rounded-xl ${config.bg} border ${config.border}`}>
      <p className="text-white text-sm">{String(schema.data.message || '')}</p>
    </div>
  );
}
