/**
 * JASIM Primitive Registry
 *
 * Maps UI Contract types to actual React component references.
 * This is the bridge between the generic UI descriptor and concrete rendering.
 *
 * Philosophy: The registry knows about primitives, not about domains.
 * No "furniture-card" or "marketplace-list" — only "Card", "List", "Form", etc.
 */

import type { UIDescriptor, UIAction } from "@contracts/dna";

// ═══════════════════════════════════════════════════════════════════════════════
// Primitive Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface PrimitiveProps {
  descriptor: UIDescriptor;
  data: Record<string, any>;
  onAction: (action: UIAction, data?: any) => void;
  theme?: {
    direction?: "ltr" | "rtl";
    density?: "compact" | "normal" | "comfortable";
    primaryColor?: string;
  };
}

export type PrimitiveComponent = React.ComponentType<PrimitiveProps>;

// ═══════════════════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════════════════

class PrimitiveRegistry {
  private primitives = new Map<string, PrimitiveComponent>();

  register(type: string, component: PrimitiveComponent): void {
    this.primitives.set(type, component);
  }

  get(type: string): PrimitiveComponent | undefined {
    return this.primitives.get(type);
  }

  has(type: string): boolean {
    return this.primitives.has(type);
  }

  list(): string[] {
    return Array.from(this.primitives.keys());
  }

  unregister(type: string): boolean {
    return this.primitives.delete(type);
  }
}

// Singleton
let instance: PrimitiveRegistry | null = null;

export function getPrimitiveRegistry(): PrimitiveRegistry {
  if (!instance) {
    instance = new PrimitiveRegistry();
  }
  return instance;
}

// Re-export for convenience
export { PrimitiveRegistry };
