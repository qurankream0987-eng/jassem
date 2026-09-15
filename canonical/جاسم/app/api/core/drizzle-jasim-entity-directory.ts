import { eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { entities } from "@db/schema";
import type {
  DiscoverableEntity,
  JasimEntityDirectory,
} from "./jasim-network-connectors";

export class DrizzleJasimEntityDirectory implements JasimEntityDirectory {
  async listDiscoverable(): Promise<DiscoverableEntity[]> {
    const rows = await db.select().from(entities).limit(500);
    return rows.map((row) => this.fromRow(row)).filter((entity) =>
      entity.metadata.discoverable === true || ["public", "shared"].includes(String(entity.metadata.visibility)),
    );
  }

  async findById(id: string): Promise<DiscoverableEntity | undefined> {
    if (!/^\d+$/.test(id)) return undefined;
    const row = await db.select().from(entities).where(eq(entities.id, Number(id))).limit(1);
    return row[0] ? this.fromRow(row[0]) : undefined;
  }

  async findByIdempotency(type: string, idempotencyKey: string): Promise<DiscoverableEntity | undefined> {
    const rows = await db.select().from(entities).where(eq(entities.type, type)).limit(200);
    const row = rows.find((candidate) => (candidate.metadata as Record<string, unknown> | null)?.idempotencyKey === idempotencyKey);
    return row ? this.fromRow(row) : undefined;
  }

  async create(input: Omit<DiscoverableEntity, "id">): Promise<DiscoverableEntity> {
    const [inserted] = await db.insert(entities).values({
      type: input.type,
      name: input.name,
      attributes: input.attributes,
      capabilities: input.capabilities,
      reputation: input.reputation,
      availability: input.availability,
      metadata: input.metadata,
      permissions: [],
      relationships: [],
    }).returning();
    return { ...input, id: String(inserted.id) };
  }

  private fromRow(row: typeof entities.$inferSelect): DiscoverableEntity {
    return {
      id: String(row.id),
      type: row.type,
      name: row.name,
      attributes: row.attributes ?? {},
      capabilities: row.capabilities ?? [],
      reputation: row.reputation ?? undefined,
      availability: row.availability ?? undefined,
      metadata: row.metadata ?? {},
    };
  }
}
