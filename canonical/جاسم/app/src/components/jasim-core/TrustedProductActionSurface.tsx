/**
 * JASIM — the trusted surface a sensitive product action is collected in.
 *
 * ─── WHY THIS IS NOT A GENERATED SURFACE ────────────────────────────────────
 *
 *   CONVERSATION INITIATES · TRUSTED RUNTIME DEFINES · TRUSTED SURFACE COLLECTS
 *
 * Every other surface in this app renders a Presentation IR a model helped
 * shape. This one renders a contract the SERVER registered, and that is the
 * whole point: a model cannot add a field here, cannot change a field from
 * SENSITIVE to anything else, and cannot decide that a confirmation is not
 * needed. Those come down from `product-actions.ts` and are read, never
 * negotiated.
 *
 * ─── AND WHY IT SENDS WHAT IT COLLECTS DIRECTLY ─────────────────────────────
 *
 *   PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
 *
 * What is typed here goes to one mutation and nowhere else. It is never put
 * into the conversation, never echoed back into a message, and cleared from
 * component state the moment the submission returns — including when it fails,
 * because a failed attempt is exactly when a value is most likely to sit in
 * memory waiting to be retried.
 */

import { useState } from 'react';

// ── The contract, as the server defines it ───────────────────────────────────

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
  /** The one mutation a collected value reaches. */
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
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [confirmation, setConfirmation] = useState<string | boolean>(
    presentation.confirmation === 'EXPLICIT' ? false : '',
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductActionSubmitResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const expired = Date.parse(expiresAt) <= Date.now();
  const blocked = presentation.availability === 'BLOCKED_BY_PROVIDER';

  /** Forget everything typed. Called on every exit from the form. */
  const forget = () => {
    setValues({});
    setRevealed({});
    setConfirmation(presentation.confirmation === 'EXPLICIT' ? false : '');
  };

  async function submit() {
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
      // A network failure is a failure, not a success with a spinner.
      setFailure(error instanceof Error ? error.message : 'تعذّر إتمام الإجراء.');
    } finally {
      // Before anything renders again, and on every path. A value that
      // survives a failed attempt is a value waiting to be leaked.
      forget();
      setBusy(false);
    }
  }

  async function cancel() {
    forget();
    setClosed(true);
    try {
      await onCancel({ actionSessionId });
    } catch {
      // Cancelling is the person's decision; a failed round trip does not
      // put them back in a form they have left.
    }
  }

  if (closed) {
    return (
      <Shell state="CANCELLED" title={presentation.title}>
        <p>تم الإلغاء. لم يتغيّر شيء.</p>
      </Shell>
    );
  }
  if (result) {
    return (
      <Shell state={result.status} title={presentation.title}>
        <p>{result.detail}</p>
      </Shell>
    );
  }
  if (expired) {
    return (
      <Shell state="EXPIRED" title={presentation.title}>
        <p>انتهت صلاحية هذا الإجراء. اطلبه مرة أخرى.</p>
      </Shell>
    );
  }

  return (
    <Shell state="AWAITING_INPUT" title={presentation.title}>
      <p className="text-[var(--jasim-text-secondary)]">{presentation.consequence}</p>
      <p data-risk={presentation.risk} className="text-xs text-[var(--jasim-text-tertiary)]">
        {RISK_NOTE[presentation.risk]}
      </p>
      {presentation.reauthentication ? (
        <p className="text-xs text-[var(--jasim-text-tertiary)]">
          سيُطلب إثبات هويتك مرة أخرى داخل هذا السطح.
        </p>
      ) : null}
      {blocked ? (
        <p data-blocked="true" className="text-xs text-[var(--jasim-text-tertiary)]">
          هذا الإجراء يحتاج مزوّداً غير موصول، ولن يُنفَّذ.
        </p>
      ) : null}

      {presentation.fields.map((field) => (
        <label key={field.key} className="block text-sm" htmlFor={`pa-${field.key}`}>
          <span className="mb-1 block">{field.label}</span>
          {field.kind === 'CHOICE' ? (
            <select
              id={`pa-${field.key}`}
              className="w-full rounded-lg border border-[var(--jasim-border)] bg-transparent px-3 py-2"
              value={String(values[field.key] ?? '')}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            >
              <option value="">—</option>
              {/* The options are the registry's. A client cannot invent one. */}
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.kind === 'BOOLEAN' ? (
            <input
              id={`pa-${field.key}`}
              type="checkbox"
              checked={values[field.key] === true}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.checked }))
              }
            />
          ) : (
            <span className="flex items-center gap-2">
              <input
                id={`pa-${field.key}`}
                // The kind decides this, and the kind came from the server.
                type={
                  field.kind === 'SENSITIVE' && !revealed[field.key]
                    ? 'password'
                    : field.kind === 'EMAIL'
                      ? 'email'
                      : 'text'
                }
                data-sensitive={field.kind === 'SENSITIVE' ? 'true' : undefined}
                autoComplete={field.kind === 'SENSITIVE' ? 'new-password' : 'off'}
                className="w-full rounded-lg border border-[var(--jasim-border)] bg-transparent px-3 py-2"
                value={String(values[field.key] ?? '')}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              {field.kind === 'SENSITIVE' ? (
                <button
                  type="button"
                  className="text-xs text-[var(--jasim-text-tertiary)]"
                  onClick={() =>
                    setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))
                  }
                >
                  {revealed[field.key] ? 'إخفاء' : 'إظهار'}
                </button>
              ) : null}
            </span>
          )}
        </label>
      ))}

      {presentation.confirmation === 'EXPLICIT' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmation === true}
            onChange={(event) => setConfirmation(event.target.checked)}
          />
          <span>أوافق على ما سبق.</span>
        </label>
      ) : null}
      {presentation.confirmation === 'EXPLICIT_PHRASE' ? (
        <label className="block text-sm" htmlFor="pa-confirm">
          {/* The phrase itself is shown, because a confirmation nobody can
              read is a confirmation nobody gave. */}
          <span className="mb-1 block">
            اكتب «{presentation.confirmationPhrase}» للتأكيد
          </span>
          <input
            id="pa-confirm"
            type="text"
            className="w-full rounded-lg border border-[var(--jasim-border)] bg-transparent px-3 py-2"
            value={String(confirmation ?? '')}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      ) : null}

      {failure ? (
        <p data-failure="true" className="text-sm text-[var(--jasim-danger,#c33)]">
          {failure}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={submit} data-action="submit">
          {busy ? '…' : 'متابعة'}
        </button>
        <button type="button" onClick={cancel} data-action="cancel">
          إلغاء
        </button>
      </div>
    </Shell>
  );
}

function Shell({
  state,
  title,
  children,
}: {
  state: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      dir="rtl"
      role="group"
      aria-label={title}
      data-trusted-action-state={state}
      className="my-2 space-y-3 rounded-xl border border-[var(--jasim-border)] bg-[var(--jasim-surface-sunken)] px-4 py-3 text-sm"
    >
      <h3 className="font-medium text-[var(--jasim-text-primary)]">{title}</h3>
      {children}
    </section>
  );
}
