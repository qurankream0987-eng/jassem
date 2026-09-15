import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let recordObservation: typeof import("../../api/runtime/block31/observations").recordObservation;
let latestObservations: typeof import("../../api/runtime/block31/observations").latestObservations;

beforeAll(async () => {
  handle = await getTestDb();
  ({ recordObservation, latestObservations } = await import("../../api/runtime/block31/observations"));
});
beforeEach(async () => {
  await handle.db.execute(sql.raw("TRUNCATE TABLE fulfillment_observations CASCADE"));
});

describe("truthful fulfillment observations", () => {
  it("records an observation carrying an accepted proof class", async () => {
    const row = await recordObservation(handle.db, {
      ownerId: "owner-a",
      subjectKind: "commercial_order",
      subjectId: "order-a",
      observerOwnerId: "observer-a",
      observationKind: "in_progress",
      proofClass: "authenticated_webhook",
      location: { lat: 24.7136, lng: 46.6753, accuracyM: 20 },
    });
    expect(row.proofClass).toBe("authenticated_webhook");
    expect(row.location).toEqual({ lat: 24.7136, lng: 46.6753, accuracyM: 20 });
  });

  it("rejects physical tracking without proof and never synthesizes location", async () => {
    await expect(recordObservation(handle.db, {
      ownerId: "owner-a",
      subjectKind: "commercial_order",
      subjectId: "order-a",
      observerOwnerId: "observer-a",
      observationKind: "in_transit",
      proofClass: "",
    })).rejects.toThrow("Invalid proofClass");

    const row = await recordObservation(handle.db, {
      ownerId: "owner-a",
      subjectKind: "commercial_order",
      subjectId: "order-a",
      observerOwnerId: "observer-a",
      observationKind: "in_transit",
      proofClass: "self_report",
    });
    expect(row.location).toBeNull();
  });

  it("returns latest rows only within the requesting owner scope", async () => {
    for (const ownerId of ["owner-a", "owner-b"]) {
      await recordObservation(handle.db, {
        ownerId,
        subjectKind: "commercial_order",
        subjectId: "shared-looking-id",
        observerOwnerId: `${ownerId}-observer`,
        observationKind: "ready",
        proofClass: "counterparty_confirm",
      });
    }
    const rows = await latestObservations(
      handle.db,
      "owner-a",
      "commercial_order",
      "shared-looking-id",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ownerId).toBe("owner-a");
  });
});