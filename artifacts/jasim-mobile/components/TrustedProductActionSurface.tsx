/**
 * JASIM mobile — the trusted surface a sensitive product action is collected in.
 *
 * The SAME contract the web renders, from the same server registration. The
 * phone adapts presentation and nothing else: it does not get its own idea of
 * which fields are sensitive, its own confirmation rules, or its own
 * authentication semantics.
 *
 *   MobileAuthRuntime — does not exist and must not.
 *
 * What is typed here goes to one mutation and is cleared from state the moment
 * it returns, on success and on failure alike. A value that survives a failed
 * attempt is a value waiting to be leaked.
 */

import React from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { fonts, palette } from '@/constants/colors';

export type ProductActionField = {
  key: string;
  label: string;
  kind: 'TEXT' | 'EMAIL' | 'CHOICE' | 'BOOLEAN' | 'SENSITIVE';
  required: boolean;
  options?: string[];
};

export type ProductActionPresentation = {
  actionId: string;
  actionVersion: number;
  title: string;
  consequence: string;
  risk: 'LOW' | 'ELEVATED' | 'HIGH' | 'IRREVERSIBLE';
  availability: 'AVAILABLE' | 'BLOCKED_BY_PROVIDER';
  reauthentication: boolean;
  confirmation: 'NONE' | 'EXPLICIT' | 'EXPLICIT_PHRASE';
  confirmationPhrase?: string;
  fields: ProductActionField[];
};

export type ProductActionSubmitResult = {
  status: string;
  outcome?: string | null;
  detail: string;
};

export type TrustedProductActionSurfaceProps = {
  actionSessionId: string;
  expiresAt: string;
  presentation: ProductActionPresentation;
  onSubmit: (input: {
    actionSessionId: string;
    actionVersion: number;
    values: Record<string, string | boolean>;
    confirmation?: string | boolean;
  }) => Promise<ProductActionSubmitResult>;
  onCancel: (input: { actionSessionId: string }) => Promise<unknown>;
};

const RISK_NOTE: Record<ProductActionPresentation['risk'], string> = {
  LOW: 'تغيير بسيط ويمكن التراجع عنه.',
  ELEVATED: 'إجراء يؤثر على جلستك.',
  HIGH: 'إجراء حسّاس على بيانات الدخول.',
  IRREVERSIBLE: 'لا يمكن التراجع عن هذا.',
};

export function TrustedProductActionSurface({
  actionSessionId,
  expiresAt,
  presentation,
  onSubmit,
  onCancel,
}: TrustedProductActionSurfaceProps) {
  const [values, setValues] = React.useState<Record<string, string | boolean>>({});
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [confirmation, setConfirmation] = React.useState<string | boolean>(
    presentation.confirmation === 'EXPLICIT' ? false : '',
  );
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ProductActionSubmitResult | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [closed, setClosed] = React.useState(false);

  const expired = Date.parse(expiresAt) <= Date.now();
  const blocked = presentation.availability === 'BLOCKED_BY_PROVIDER';

  const forget = React.useCallback(() => {
    setValues({});
    setRevealed({});
    setConfirmation(presentation.confirmation === 'EXPLICIT' ? false : '');
  }, [presentation.confirmation]);

  const submit = React.useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await onSubmit({
        actionSessionId,
        actionVersion: presentation.actionVersion,
        values,
        ...(presentation.confirmation === 'NONE' ? {} : { confirmation }),
      });
      setResult(outcome);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'تعذّر إتمام الإجراء.');
    } finally {
      forget();
      setBusy(false);
    }
  }, [
    actionSessionId,
    confirmation,
    forget,
    onSubmit,
    presentation.actionVersion,
    presentation.confirmation,
    values,
  ]);

  const cancel = React.useCallback(async () => {
    forget();
    setClosed(true);
    try {
      await onCancel({ actionSessionId });
    } catch {
      // The person has left the form. A failed round trip does not put them
      // back into it.
    }
  }, [actionSessionId, forget, onCancel]);

  if (closed) return <Notice title={presentation.title} state="CANCELLED" body="تم الإلغاء. لم يتغيّر شيء." />;
  if (result) return <Notice title={presentation.title} state={result.status} body={result.detail} />;
  if (expired) {
    return (
      <Notice
        title={presentation.title}
        state="EXPIRED"
        body="انتهت صلاحية هذا الإجراء. اطلبه مرة أخرى."
      />
    );
  }

  return (
    // Keyboard avoidance, because a password field at the bottom of a phone
    // screen is a password field nobody can see while they type it.
    <KeyboardAwareScrollViewCompat
      style={styles.card}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID={`trusted-action-${presentation.actionId}`}
    >
      <Text style={styles.title} accessibilityRole="header">
        {presentation.title}
      </Text>
      <Text style={styles.body}>{presentation.consequence}</Text>
      <Text style={styles.note} testID={`risk-${presentation.risk}`}>
        {RISK_NOTE[presentation.risk]}
      </Text>
      {presentation.reauthentication ? (
        <Text style={styles.note}>سيُطلب إثبات هويتك مرة أخرى داخل هذا السطح.</Text>
      ) : null}
      {blocked ? (
        <Text style={styles.note} testID="blocked">
          هذا الإجراء يحتاج مزوّداً غير موصول، ولن يُنفَّذ.
        </Text>
      ) : null}

      {presentation.fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          {field.kind === 'BOOLEAN' ? (
            <Switch
              value={values[field.key] === true}
              onValueChange={(next) =>
                setValues((current) => ({ ...current, [field.key]: next }))
              }
            />
          ) : field.kind === 'CHOICE' ? (
            <View style={styles.choices}>
              {(field.options ?? []).map((option) => (
                <Pressable
                  key={option}
                  testID={`option-${option}`}
                  onPress={() => setValues((current) => ({ ...current, [field.key]: option }))}
                  style={[
                    styles.choice,
                    values[field.key] === option ? styles.choiceOn : null,
                  ]}
                >
                  <Text style={styles.choiceText}>{option}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.row}>
              <TextInput
                testID={`field-${field.key}`}
                // The kind decides this, and the kind came from the server.
                secureTextEntry={field.kind === 'SENSITIVE' && !revealed[field.key]}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType={field.kind === 'SENSITIVE' ? 'newPassword' : 'none'}
                keyboardType={field.kind === 'EMAIL' ? 'email-address' : 'default'}
                value={String(values[field.key] ?? '')}
                onChangeText={(next) =>
                  setValues((current) => ({ ...current, [field.key]: next }))
                }
                style={[styles.input, { textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
              />
              {field.kind === 'SENSITIVE' ? (
                <Pressable
                  testID={`reveal-${field.key}`}
                  onPress={() =>
                    setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))
                  }
                >
                  <Text style={styles.note}>{revealed[field.key] ? 'إخفاء' : 'إظهار'}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      ))}

      {presentation.confirmation === 'EXPLICIT' ? (
        <View style={styles.row}>
          <Switch
            testID="confirm-explicit"
            value={confirmation === true}
            onValueChange={setConfirmation}
          />
          <Text style={styles.body}>أوافق على ما سبق.</Text>
        </View>
      ) : null}
      {presentation.confirmation === 'EXPLICIT_PHRASE' ? (
        <View style={styles.field}>
          <Text style={styles.label}>اكتب «{presentation.confirmationPhrase}» للتأكيد</Text>
          <TextInput
            testID="confirm-phrase"
            value={String(confirmation ?? '')}
            onChangeText={setConfirmation}
            style={[styles.input, { textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
          />
        </View>
      ) : null}

      {failure ? (
        <Text style={styles.failure} testID="failure">
          {failure}
        </Text>
      ) : null}

      <View style={styles.row}>
        <Pressable testID="submit" onPress={submit} disabled={busy} style={styles.button}>
          {busy ? <ActivityIndicator testID="busy" /> : <Text style={styles.buttonText}>متابعة</Text>}
        </Pressable>
        <Pressable testID="cancel" onPress={cancel} style={styles.button}>
          <Text style={styles.buttonText}>إلغاء</Text>
        </Pressable>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

function Notice({ title, state, body }: { title: string; state: string; body: string }) {
  return (
    <View style={styles.card} testID={`trusted-action-state-${state}`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.text3,
    backgroundColor: palette.windowInner1,
    padding: 16,
    marginVertical: 8,
  },
  content: { gap: 10 },
  title: { fontFamily: fonts.medium, fontSize: 16, color: palette.text, textAlign: 'right' },
  body: { fontFamily: fonts.regular, fontSize: 14, color: palette.text2, textAlign: 'right' },
  note: { fontFamily: fonts.regular, fontSize: 12, color: palette.text3, textAlign: 'right' },
  failure: { fontFamily: fonts.regular, fontSize: 13, color: palette.text, textAlign: 'right' },
  field: { gap: 6 },
  label: { fontFamily: fonts.regular, fontSize: 13, color: palette.text2, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.text3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontFamily: fonts.regular,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.text3,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  choiceOn: { backgroundColor: palette.windowInner0 },
  choiceText: { fontFamily: fonts.regular, fontSize: 13, color: palette.text },
  button: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.text3,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonText: { fontFamily: fonts.medium, fontSize: 14, color: palette.text },
});
