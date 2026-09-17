import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  safeParsePresentationDefinition,
  type PresentationAction,
  type PresentationDefinition,
  type PresentationField,
  type PresentationPrimitive,
} from '@workspace/jasim-runtime-contract';
import { fonts, palette } from '@/constants/colors';
import {
  MOBILE_PRESENTATION_REGISTRY,
  type MobilePresentationPolicy,
  type MobilePresentationRendererKind,
  resolveMobilePresentationPolicy,
} from '@/lib/mobile-presentation';

export type MobilePresentationAction = {
  intent: string;
  payload?: Record<string, unknown>;
};

export type MobilePresentationRendererProps = {
  presentation: unknown;
  onAction?: (action: MobilePresentationAction) => void | Promise<void>;
  onSubmit?: (
    values: Record<string, unknown>,
  ) => void | Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  compact?: boolean;
};

function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean).join('، ');
  return fallback;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item)),
      )
    : [];
}

function entityId(entity: Record<string, unknown>, index: number): string {
  return textValue(
    entity.ref ?? entity.entityRef ?? entity.id ?? entity.key,
    `entity-${index + 1}`,
  );
}

function entityAttributes(entity: Record<string, unknown>): Array<[string, string]> {
  const reserved = new Set([
    'id',
    'ref',
    'entityRef',
    'key',
    'title',
    'name',
    'label',
    'subtitle',
    'description',
    'summary',
    'status',
    'badges',
    'actions',
    'attributes',
    'source',
    'provenance',
    'image',
    'media',
  ]);
  const source =
    entity.attributes && typeof entity.attributes === 'object' && !Array.isArray(entity.attributes)
      ? recordValue(entity.attributes)
      : Object.fromEntries(
          Object.entries(entity).filter(([key]) => !reserved.has(key)),
        );
  return Object.entries(source)
    .map(([key, value]) => [key, textValue(value)] as [string, string])
    .filter(([, value]) => value.length > 0)
    .slice(0, 8);
}

function ActionButton({
  action,
  onPress,
  testID,
  secondary = false,
}: {
  action: PresentationAction;
  onPress: () => void;
  testID?: string;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      disabled={action.intent === 'cancel' && action.external}
      onPress={onPress}
      testID={testID}
      style={[styles.actionButton, secondary && styles.actionButtonSecondary]}
    >
      <Text style={[styles.actionButtonText, secondary && styles.actionButtonTextSecondary]}>
        {action.label}
      </Text>
    </Pressable>
  );
}

function EntityCard({
  entity,
  index,
  onAction,
}: {
  entity: Record<string, unknown>;
  index: number;
  onAction?: (action: MobilePresentationAction) => void | Promise<void>;
}) {
  const actions = arrayRecords(entity.actions);
  const id = entityId(entity, index);
  return (
    <View style={styles.entityCard} testID={`mobile-entity-card-${id}`}>
      <View style={styles.entityHeader}>
        <View style={styles.entityHeading}>
          <Text style={styles.entityTitle} numberOfLines={2}>
            {textValue(entity.title ?? entity.name ?? entity.label, 'بدون عنوان')}
          </Text>
          {textValue(entity.subtitle) ? (
            <Text style={styles.entitySubtitle} numberOfLines={2}>
              {textValue(entity.subtitle)}
            </Text>
          ) : null}
        </View>
        {textValue(entity.status) ? (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{textValue(entity.status)}</Text>
          </View>
        ) : null}
      </View>
      {textValue(entity.description ?? entity.summary) ? (
        <Text style={styles.bodyText}>{textValue(entity.description ?? entity.summary)}</Text>
      ) : null}
      {Array.isArray(entity.badges) && entity.badges.length > 0 ? (
        <View style={styles.badges}>
          {entity.badges.slice(0, 6).map((badge, badgeIndex) => (
            <View key={`${textValue(badge)}-${badgeIndex}`} style={styles.badge}>
              <Text style={styles.badgeText}>{textValue(badge)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {entityAttributes(entity).length > 0 ? (
        <View style={styles.attributeGrid}>
          {entityAttributes(entity).map(([key, value]) => (
            <View key={key} style={styles.attribute}>
              <Text style={styles.attributeKey}>{key}</Text>
              <Text style={styles.attributeValue} numberOfLines={2}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {textValue(entity.source ?? entity.provenance) ? (
        <Text style={styles.provenance}>{textValue(entity.source ?? entity.provenance)}</Text>
      ) : null}
      {actions.length > 0 ? (
        <View style={styles.actionsRow}>
          {actions.slice(0, 4).map((action, actionIndex) => {
            const intent = textValue(action.intent, 'select');
            return (
              <Pressable
                key={`${intent}-${actionIndex}`}
                accessibilityRole="button"
                accessibilityLabel={textValue(action.label, intent)}
                onPress={() =>
                  void onAction?.({
                    intent,
                    payload: { reference: id, entity },
                  })
                }
                style={styles.actionButtonSecondary}
                testID={`mobile-entity-action-${intent}-${id}`}
              >
                <Text style={styles.actionButtonTextSecondary}>
                  {textValue(action.label, intent)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function renderDataText(data: Record<string, unknown>): string {
  return textValue(data.text ?? data.body ?? data.summary ?? data.description, 'لا توجد تفاصيل إضافية.');
}

function FormSurface({
  presentation,
  onSubmit,
}: {
  presentation: PresentationDefinition;
  onSubmit?: MobilePresentationRendererProps['onSubmit'];
}) {
  const fields = presentation.fields ?? [];
  const metadata = arrayRecords(presentation.data.fields);
  const initialValues = useMemo(() => {
    const result: Record<string, unknown> = {};
    fields.forEach((field) => {
      const configured = recordValue(metadata.find((item) => item.name === field.name));
      if (configured.defaultValue !== undefined) result[field.name] = configured.defaultValue;
      else if (configured.value !== undefined) result[field.name] = configured.value;
    });
    return result;
  }, [fields, metadata]);
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [submitted, setSubmitted] = useState(false);

  const update = (field: PresentationField, rawValue: string) => {
    let value: unknown = rawValue;
    if (field.type === 'number') {
      const parsed = Number(rawValue);
      value = rawValue.trim() === '' || Number.isNaN(parsed) ? rawValue : parsed;
    } else if (field.type === 'boolean') {
      value = rawValue === 'true';
    }
    setValues((current) => ({ ...current, [field.name]: value }));
    setSubmitted(false);
  };

  const submit = async () => {
    const missing = fields.find(
      (field) => {
        const value = values[field.name];
        return (
          field.requiredNow &&
          (value === undefined ||
            value === '' ||
            (Array.isArray(value) && value.length === 0))
        );
      },
    );
    if (missing) return;
    setSubmitted(true);
    await onSubmit?.(values);
  };

  return (
    <View style={styles.form} testID="mobile-presentation-form">
      {fields.map((field) => {
        const configured = recordValue(metadata.find((item) => item.name === field.name));
        const options = arrayRecords(configured.options);
        const currentValue = values[field.name];
        return (
          <View key={field.name} style={styles.field}>
            <Text style={styles.fieldLabel}>
              {field.label ?? field.name}
              {field.requiredNow ? ' *' : ''}
            </Text>
            {field.unknown ? (
              <Text style={styles.fieldHint}>هذه القيمة غير مؤكدة بعد.</Text>
            ) : null}
            {options.length > 0 ? (
              <View style={styles.optionsWrap}>
                {options.map((option, optionIndex) => {
                  const optionValue = textValue(option.value ?? option.id ?? option.label);
                  const selected = Array.isArray(currentValue)
                    ? currentValue.includes(optionValue)
                    : currentValue === optionValue;
                  return (
                    <Pressable
                      key={`${optionValue}-${optionIndex}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() =>
                        setValues((current) => ({
                          ...current,
                          [field.name]: field.type === 'array'
                            ? selected
                              ? (Array.isArray(current[field.name])
                                ? current[field.name] as unknown[]
                                : []).filter((item) => item !== optionValue)
                                : [
                                    ...(Array.isArray(current[field.name])
                                      ? current[field.name] as unknown[]
                                      : []),
                                    optionValue,
                                  ]
                            : optionValue,
                        }))
                      }
                      style={[styles.option, selected && styles.optionSelected]}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {textValue(option.label ?? option.title, optionValue)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : field.type === 'boolean' ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: currentValue === true }}
                onPress={() => update(field, currentValue === true ? 'false' : 'true')}
                style={[styles.booleanField, currentValue === true && styles.optionSelected]}
              >
                <Text style={styles.optionText}>
                  {currentValue === true ? 'مفعّل' : 'غير مفعّل'}
                </Text>
              </Pressable>
            ) : (
              <TextInput
                accessibilityLabel={field.label ?? field.name}
                editable={!field.readOnly}
                keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                multiline={field.type === 'object'}
                onChangeText={(value) => update(field, value)}
                placeholder={textValue(configured.placeholder)}
                placeholderTextColor="rgba(148,163,184,0.55)"
                style={[styles.fieldInput, field.type === 'object' && styles.fieldInputMultiline]}
                textAlign="right"
                value={textValue(currentValue)}
              />
            )}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        disabled={submitted}
        onPress={() => void submit()}
        style={[styles.primaryButton, submitted && styles.disabledButton]}
        testID="mobile-presentation-submit"
      >
        {submitted ? (
          <ActivityIndicator color="#02131c" size="small" />
        ) : (
          <Text style={styles.primaryButtonText}>إرسال</Text>
        )}
      </Pressable>
    </View>
  );
}

function PresentationContent({
  presentation,
  kind,
  onAction,
  onSubmit,
}: {
  presentation: PresentationDefinition;
  kind: MobilePresentationRendererKind;
  onAction?: MobilePresentationRendererProps['onAction'];
  onSubmit?: MobilePresentationRendererProps['onSubmit'];
}) {
  const data = presentation.data;
  if (kind === 'text') {
    return <Text style={styles.bodyText}>{renderDataText(data)}</Text>;
  }
  if (kind === 'entity') {
    const entity = recordValue(data.entity);
    return <EntityCard entity={Object.keys(entity).length > 0 ? entity : data} index={0} onAction={onAction} />;
  }
  if (kind === 'collection') {
    const items = arrayRecords(data.items ?? data.candidates ?? data.entities);
    return (
      <View style={styles.collection} testID="mobile-entity-collection">
        {items.length === 0 ? (
          <Text style={styles.emptyText}>لا توجد نتائج متاحة حاليًا.</Text>
        ) : (
          items.map((item, index) => (
            <EntityCard key={entityId(item, index)} entity={item} index={index} onAction={onAction} />
          ))
        )}
      </View>
    );
  }
  if (kind === 'comparison') {
    const items = arrayRecords(data.items ?? data.candidates ?? data.entities);
    return (
      <View style={styles.collection} testID="mobile-comparison">
        {items.map((item, index) => (
          <EntityCard key={entityId(item, index)} entity={item} index={index} onAction={onAction} />
        ))}
      </View>
    );
  }
  if (kind === 'form') return <FormSurface presentation={presentation} onSubmit={onSubmit} />;
  if (kind === 'choice') {
    const options = arrayRecords(data.options ?? data.items);
    return (
      <View style={styles.collection} testID="mobile-choice">
        {options.map((option, index) => {
          const reference = textValue(option.ref ?? option.entityRef ?? option.value ?? option.id, `option-${index + 1}`);
          return (
            <Pressable
              key={`${reference}-${index}`}
              accessibilityRole="button"
              onPress={() => void onAction?.({ intent: 'select', payload: { reference, option } })}
              style={styles.choiceButton}
              testID={`mobile-choice-${reference}`}
            >
              <Text style={styles.choiceText}>{textValue(option.label ?? option.title, reference)}</Text>
              <Text style={styles.choiceReference}>{reference}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  if (kind === 'approval') {
    return (
      <View style={styles.approval} testID="mobile-approval">
        <Text style={styles.bodyText}>{renderDataText(data)}</Text>
        {textValue(data.amount ?? data.total) ? (
          <Text style={styles.approvalValue}>{textValue(data.amount ?? data.total)}</Text>
        ) : null}
      </View>
    );
  }
  if (kind === 'timeline') {
    const items = arrayRecords(data.items ?? data.events ?? data.steps);
    return (
      <View style={styles.timeline} testID="mobile-timeline">
        {items.map((item, index) => (
          <View key={`${textValue(item.id)}-${index}`} style={styles.timelineRow}>
            <View style={styles.timelineDot} />
            <View style={styles.timelineContent}>
              <Text style={styles.entityTitle}>{textValue(item.title ?? item.label, `المرحلة ${index + 1}`)}</Text>
              {textValue(item.description ?? item.summary ?? item.status) ? (
                <Text style={styles.entitySubtitle}>{textValue(item.description ?? item.summary ?? item.status)}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (kind === 'map') {
    // A map is drawn ONLY from coordinates the server put in the projection.
    // Nothing here interpolates a position, smooths between points, guesses a
    // route or computes an ETA — a convincing map built on nothing is worse
    // than no map, because the person will act on it.
    const markers = arrayRecords(data.markers).filter((marker) => {
      const coordinates = marker.coordinates as Record<string, unknown> | undefined;
      return (
        typeof coordinates?.lat === 'number' &&
        Number.isFinite(coordinates.lat) &&
        typeof coordinates?.lng === 'number' &&
        Number.isFinite(coordinates.lng)
      );
    });
    if (markers.length === 0) {
      return (
        <View style={styles.state} testID="mobile-map-unavailable">
          <Text style={styles.stateTitle}>لا يوجد موقع حي متاح</Text>
          <Text style={styles.bodyText}>
            لم يصل إلى جاسم موقع موثوق وحديث لهذا الطلب، ولن يُعرض موقع تقديري.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.map} testID="mobile-map">
        {markers.map((marker, index) => {
          const coordinates = marker.coordinates as { lat: number; lng: number };
          const reference = textValue(marker.entityRef, `الموقع ${index + 1}`);
          return (
            <View key={`${reference}-${index}`} style={styles.mapMarker} testID="mobile-map-marker">
              <View style={styles.mapMarkerDot} />
              <View style={styles.mapMarkerBody}>
                <Text style={styles.entityTitle}>{reference}</Text>
                <Text style={styles.mapCoordinates}>
                  {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
                </Text>
                {textValue(marker.observedAt) ? (
                  <Text style={styles.entitySubtitle}>{textValue(marker.observedAt)}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  }
  if (kind === 'document') {
    return (
      <View style={styles.document} testID="mobile-document">
        <Text style={styles.bodyText}>{renderDataText(data)}</Text>
        {textValue(data.content ?? data.markdown) ? (
          <Text style={styles.documentText}>{textValue(data.content ?? data.markdown)}</Text>
        ) : null}
      </View>
    );
  }
  return (
    <View
      style={[
        styles.state,
        presentation.primitive === 'ERROR_STATE' && styles.errorState,
        presentation.primitive === 'WARNING' && styles.warningState,
      ]}
      testID={`mobile-${presentation.primitive.toLowerCase()}`}
    >
      <Text style={styles.stateTitle}>
        {textValue(data.title, presentation.primitive === 'EMPTY_STATE' ? 'لا توجد بيانات' : 'تنبيه')}
      </Text>
      <Text style={styles.bodyText}>{renderDataText(data)}</Text>
    </View>
  );
}

export function MobilePresentationRenderer({
  presentation,
  onAction,
  onSubmit,
  isLoading = false,
  error = null,
  compact = false,
}: MobilePresentationRendererProps) {
  const parsed = safeParsePresentationDefinition(presentation);
  if (!parsed.success) {
    return (
      <View style={styles.fallback} testID="mobile-presentation-invalid">
        <Text style={styles.stateTitle}>تعذر عرض هذا السطح</Text>
        <Text style={styles.bodyText}>بيانات العرض غير صالحة أو لم تعد متاحة.</Text>
      </View>
    );
  }
  const definition = parsed.data;
  const kind = MOBILE_PRESENTATION_REGISTRY[definition.primitive];
  if (!kind) {
    return (
      <View style={styles.fallback} testID="mobile-presentation-unsupported">
        <Text style={styles.stateTitle}>هذا النوع غير مدعوم على الهاتف</Text>
        <Text style={styles.bodyText}>يمكن متابعة المحادثة دون تنفيذ إجراء غير معروف.</Text>
      </View>
    );
  }
  return (
    <View
      accessibilityRole="none"
      style={[styles.surface, compact && styles.surfaceCompact]}
      testID="mobile-presentation-renderer"
    >
      {definition.title ? (
        <Text style={styles.surfaceTitle} numberOfLines={2}>{definition.title}</Text>
      ) : null}
      {isLoading ? (
        <View style={styles.loading} testID="mobile-presentation-loading">
          <ActivityIndicator color={palette.cyan} />
          <Text style={styles.bodyText}>جارٍ تجهيز العرض…</Text>
        </View>
      ) : error ? (
        <View style={styles.state} testID="mobile-presentation-error">
          <Text style={styles.stateTitle}>حدث خطأ</Text>
          <Text style={styles.bodyText}>{error}</Text>
        </View>
      ) : (
        <PresentationContent
          presentation={definition}
          kind={kind}
          onAction={onAction}
          onSubmit={onSubmit}
        />
      )}
      {definition.actions && definition.actions.length > 0 ? (
        <View style={styles.actionsRow}>
          {definition.actions.slice(0, 5).map((action, index) => (
            <ActionButton
              key={`${action.intent}-${index}`}
              action={action}
              onPress={() => void onAction?.({ intent: action.intent })}
              secondary={action.intent === 'cancel' || action.intent === 'reject'}
              testID={`mobile-presentation-action-${action.intent}`}
            />
          ))}
        </View>
      ) : null}
      {definition.children?.map((child, index) => (
        <MobilePresentationRenderer
          key={`${definition.primitive}-child-${index}`}
          presentation={child}
          onAction={onAction}
          onSubmit={onSubmit}
          compact
        />
      ))}
    </View>
  );
}

const styles = {
  surface: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(92,229,216,0.24)',
    backgroundColor: 'rgba(2,19,28,0.82)',
    padding: 14,
  },
  surfaceCompact: {
    borderColor: 'rgba(148,163,184,0.18)',
    backgroundColor: 'rgba(15,23,42,0.62)',
    padding: 10,
  },
  surfaceTitle: {
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 15,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  bodyText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  entityCard: {
    gap: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    padding: 11,
  },
  entityHeader: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  entityHeading: {
    flex: 1,
    gap: 2,
  },
  entityTitle: {
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  entitySubtitle: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(92,229,216,0.35)',
    backgroundColor: 'rgba(92,229,216,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipText: {
    color: palette.cyan,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  badges: {
    flexDirection: 'row-reverse' as const,
    flexWrap: 'wrap' as const,
    gap: 5,
  },
  badge: {
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.14)',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    color: '#d8b4fe',
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  attributeGrid: {
    gap: 6,
  },
  attribute: {
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  attributeKey: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right' as const,
  },
  attributeValue: {
    color: palette.text,
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'right' as const,
  },
  provenance: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right' as const,
  },
  collection: {
    gap: 8,
  },
  actionsRow: {
    flexDirection: 'row-reverse' as const,
    flexWrap: 'wrap' as const,
    gap: 7,
    marginTop: 2,
  },
  actionButton: {
    alignItems: 'center' as const,
    borderRadius: 10,
    backgroundColor: palette.cyan,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonSecondary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(92,229,216,0.35)',
    backgroundColor: 'rgba(92,229,216,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  actionButtonText: {
    color: '#02131c',
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  actionButtonTextSecondary: {
    color: palette.cyan,
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  choiceButton: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  choiceText: {
    flex: 1,
    color: palette.text,
    fontFamily: fonts.medium,
    fontSize: 12,
    textAlign: 'right' as const,
  },
  choiceReference: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  approval: {
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.08)',
    padding: 10,
  },
  approvalValue: {
    color: '#fde68a',
    fontFamily: fonts.bold,
    fontSize: 18,
    textAlign: 'right' as const,
  },
  timeline: {
    gap: 9,
  },
  timelineRow: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'flex-start' as const,
    gap: 9,
  },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.cyan,
    marginTop: 5,
  },
  timelineContent: {
    flex: 1,
    gap: 2,
  },
  document: {
    gap: 8,
  },
  documentText: {
    color: palette.text,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  form: {
    gap: 12,
  },
  field: {
    gap: 5,
  },
  fieldLabel: {
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  fieldHint: {
    color: '#fbbf24',
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right' as const,
  },
  fieldInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(15,23,42,0.7)',
    color: palette.text,
    fontFamily: fonts.regular,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fieldInputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top' as const,
  },
  optionsWrap: {
    flexDirection: 'row-reverse' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  option: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionSelected: {
    borderColor: 'rgba(92,229,216,0.65)',
    backgroundColor: 'rgba(92,229,216,0.16)',
  },
  optionText: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  optionTextSelected: {
    color: palette.cyan,
  },
  booleanField: {
    alignSelf: 'flex-end' as const,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryButton: {
    alignItems: 'center' as const,
    borderRadius: 11,
    backgroundColor: palette.cyan,
    minHeight: 42,
    justifyContent: 'center' as const,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#02131c',
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  disabledButton: {
    opacity: 0.7,
  },
  map: {
    gap: 10,
  },
  mapMarker: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
  },
  mapMarkerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: palette.cyan,
  },
  mapMarkerBody: {
    flex: 1,
    gap: 2,
  },
  mapCoordinates: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 12,
    textAlign: 'right' as const,
  },
  state: {
    gap: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(148,163,184,0.08)',
    padding: 11,
  },
  warningState: {
    backgroundColor: 'rgba(245,158,11,0.1)',
  },
  errorState: {
    backgroundColor: 'rgba(244,63,94,0.1)',
  },
  stateTitle: {
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 13,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  emptyText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 12,
    paddingVertical: 12,
    textAlign: 'center' as const,
  },
  loading: {
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 14,
  },
  fallback: {
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(120,53,15,0.18)',
    padding: 12,
  },
};