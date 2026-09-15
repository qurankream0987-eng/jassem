/**
 * Compiles semantic WorldDNA UI descriptors into runtime bubbles.
 *
 * The compiler only knows presentation primitives. It never knows what a car,
 * watch, shop, course, family archive or marketplace is. Meaning, data fields,
 * actions and runtime bindings all come from the generated world.
 */

import type { UIDescriptor, WorldDNA } from "@contracts/dna";
import type { BubbleSchema, BubbleType } from "@contracts/jasim";

const PRIMITIVE_MAP: Record<UIDescriptor["type"], BubbleType> = {
  form: "form",
  list: "list",
  detail: "card",
  search: "search",
  filter: "filter",
  comparison: "comparison",
  gallery: "gallery",
  chart: "dashboard",
  calendar: "timeline",
  map: "map",
  kanban: "table",
  progress: "progress",
  confirmation: "confirmation",
  actions: "card",
  breadcrumb: "card",
  navigation: "list",
  stats: "dashboard",
};

export class GenerativeBubbleCompiler {
  compile(world: WorldDNA): BubbleSchema[] {
    const descriptors = world.ui.flatMap((descriptor) => this.flatten(descriptor));
    if (descriptors.length === 0) return [this.worldOverview(world)];

    return descriptors.map((descriptor, index) => {
      const entity = world.entities.find((item) => item.id === descriptor.entityId);
      const workflow = world.workflows.find((item) =>
        item.steps.some((step) => descriptor.actions.some((action) => action.capabilityBinding === step.capabilityBinding)),
      );
      const fields = descriptor.fields
        .map((fieldId) => entity?.fields.find((field) => field.id === fieldId))
        .filter((field): field is NonNullable<typeof field> => Boolean(field));

      return {
        id: `bubble_${world.id}_${this.safeId(descriptor.id)}_${index}`,
        type: PRIMITIVE_MAP[descriptor.type],
        title: descriptor.title ?? entity?.label ?? world.name,
        subtitle: descriptor.description ?? entity?.description ?? world.description,
        layout: {
          columns: descriptor.layout.columns,
          width: descriptor.type === "confirmation" ? "compact" : "full",
          rtl: world.theme.direction === "rtl",
          compact: descriptor.layout.density === "compact",
        },
        theme: {
          accent: world.theme.primaryColor,
          rtl: world.theme.direction === "rtl",
          glassmorphism: true,
        },
        data: {
          worldId: world.id,
          worldVersion: world.version,
          continuity: world.continuity,
          purpose: world.purpose,
          entityId: descriptor.entityId,
          fields,
          dataSource: descriptor.dataSource,
          items: [],
        },
        actions: descriptor.actions.map((action) => ({
          id: action.id,
          label: action.label,
          type: action.variant === "danger" ? "cancel" : "submit",
          capabilityBinding: action.capabilityBinding,
          targetEntity: descriptor.entityId,
          workflowId: workflow?.id,
          requiresApproval: this.requiresApproval(world, action.capabilityBinding),
          metadata: { condition: action.condition, generated: true },
        })),
        trust: { level: "system", verified: true, badges: ["generated", "world-bound"] },
        version: world.version,
        metadata: {
          generated: true,
          descriptorId: descriptor.id,
          worldId: world.id,
          entityId: descriptor.entityId,
          scope: world.continuity,
        },
      } satisfies BubbleSchema;
    });
  }

  private flatten(descriptor: UIDescriptor): UIDescriptor[] {
    return [descriptor, ...descriptor.children.flatMap((child) => this.flatten(child))];
  }

  private worldOverview(world: WorldDNA): BubbleSchema {
    return {
      id: `bubble_${world.id}_overview`,
      type: "dashboard",
      title: world.name,
      subtitle: world.description,
      layout: { width: "full", rtl: world.theme.direction === "rtl" },
      data: {
        worldId: world.id,
        purpose: world.purpose,
        continuity: world.continuity,
        participants: world.participants,
        entities: world.entities.map((entity) => ({ id: entity.id, label: entity.label })),
      },
      actions: [],
      trust: { level: "system", verified: true, badges: ["generated", "world-bound"] },
      version: world.version,
      metadata: { generated: true, worldId: world.id, scope: world.continuity },
    };
  }

  private requiresApproval(world: WorldDNA, capability: string): boolean {
    return world.policies.some((policy) =>
      policy.target === capability && policy.action === "require_approval",
    );
  }

  private safeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  }
}

