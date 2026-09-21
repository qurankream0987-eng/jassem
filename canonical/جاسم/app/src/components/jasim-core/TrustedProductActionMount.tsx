/**
 * The transport half of the trusted product-action surface.
 *
 * Kept apart from the surface itself so the surface stays a pure renderer of a
 * server contract — testable without a transport, and reusable by anything
 * that already has one. This half knows one mutation and one cancellation, and
 * it is the only path a collected value takes.
 *
 * Rendered only when a turn actually initiated an action, which is why the
 * hooks live here: a conversation with no product action touches no transport.
 */

import { trpc } from '@/providers/trpc';
import {
  TrustedProductActionSurface,
  type ProductActionPresentation,
} from './TrustedProductActionSurface';

export function TrustedProductActionMount({
  actionSessionId,
  expiresAt,
  presentation,
}: {
  actionSessionId: string;
  expiresAt: string;
  presentation: ProductActionPresentation;
}) {
  const submit = trpc.runtime.productActionSubmit.useMutation();
  const cancel = trpc.runtime.productActionCancel.useMutation();
  return (
    <TrustedProductActionSurface
      actionSessionId={actionSessionId}
      expiresAt={expiresAt}
      presentation={presentation}
      onSubmit={(input) => submit.mutateAsync(input)}
      onCancel={(input) => cancel.mutateAsync(input)}
    />
  );
}
