/**
 * Generic binding between a persisted Generated World and Block 3's existing
 * commercial primitives. This module deliberately knows nothing about the
 * world's category, capabilities, or business vocabulary.
 *
 * Ownership is checked before either primitive is created. Subsequent
 * changes must use commercial-changesets.ts, so preview/owner approval and
 * versioning remain the sole mutation path.
 */
import { createPlan } from "./subscriptions";
import { createFeeRule } from "./fee-rules";
import type { Block2Db } from "../block2/temporal";
import type { GeneratedWorldService } from "../../core/generated-world-service";
import type { FeeRuleRecord, PlanRecord } from "@db/schema";

export class GeneratedBusinessEconomicsError extends Error {
  readonly code: "WORLD_NOT_FOUND" | "WORLD_NOT_OWNED";
  constructor(message: string, code: "WORLD_NOT_FOUND" | "WORLD_NOT_OWNED") {
    super(message);
    this.code = code;
  }
}

type WorldReader = Pick<GeneratedWorldService, "get">;

async function assertWorldOwner(worlds: WorldReader, ownerId: number, worldId: string): Promise<void> {
  const world = await worlds.get(ownerId, worldId);
  if (!world) throw new GeneratedBusinessEconomicsError("Generated World not found or not owned", "WORLD_NOT_FOUND");
  if (String(world.ownerId) !== String(ownerId)) {
    throw new GeneratedBusinessEconomicsError("Generated World is owned by a different owner", "WORLD_NOT_OWNED");
  }
}

/** Create an owner-configured generic Plan attached to a generated World. */
export async function createWorldPlan(
  db: Block2Db,
  worlds: WorldReader,
  input: Parameters<typeof createPlan>[1] & { worldId: string; ownerNumericId: number },
): Promise<PlanRecord> {
  await assertWorldOwner(worlds, input.ownerNumericId, input.worldId);
  const { worldId, ownerNumericId: _ownerNumericId, ...plan } = input;
  return createPlan(db, { ...plan, worldId });
}

/** Create an owner-configured generic FeeRule attached to a generated World. */
export async function createWorldFeeRule(
  db: Block2Db,
  worlds: WorldReader,
  input: Parameters<typeof createFeeRule>[1] & { worldId: string; ownerNumericId: number },
): Promise<FeeRuleRecord> {
  await assertWorldOwner(worlds, input.ownerNumericId, input.worldId);
  const { worldId, ownerNumericId: _ownerNumericId, ...rule } = input;
  return createFeeRule(db, { ...rule, worldId });
}