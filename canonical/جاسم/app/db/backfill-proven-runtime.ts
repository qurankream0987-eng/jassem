/**
 * One-off backfill: proven-runtime conversations/messages (jasim_runtime_*)
 * into the canonical conversations/messages tables.
 *
 * - Creates one canonical `users` row per distinct legacy ownerId
 *   (unionId = "dev:<ownerId>") so ownership stays canonical.
 * - Maps legacy uuid conversation ids to new canonical serial ids.
 * - Never touches the legacy tables (non-destructive).
 * - Idempotent: skips entirely if canonical conversations already exist.
 *
 * Run: pnpm exec tsx db/backfill-proven-runtime.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../api/queries/connection";
import { conversations, messages, users } from "./schema";

type LegacyConversation = {
  id: string;
  owner_id: string;
  title: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

type LegacyMessage = {
  id: string;
  conversation_id: string;
  owner_id: string;
  role: string;
  content: string;
  output_kind: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

async function main() {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .limit(1);
  if (existing.length > 0) {
    console.log("canonical conversations already present — backfill skipped");
    return;
  }

  const legacyConversations = await db.execute<LegacyConversation>(
    sql`SELECT id, owner_id, title, status, created_at, updated_at FROM jasim_runtime_conversations ORDER BY created_at`,
  );
  const legacyMessages = await db.execute<LegacyMessage>(
    sql`SELECT id, conversation_id, owner_id, role, content, output_kind, metadata, created_at FROM jasim_runtime_messages ORDER BY created_at`,
  );

  const ownerIds = [
    ...new Set([
      ...legacyConversations.rows.map((r) => r.owner_id),
      ...legacyMessages.rows.map((r) => r.owner_id),
    ]),
  ];

  const userIdByOwner = new Map<string, number>();
  for (const owner of ownerIds) {
    const unionId = `dev:${owner}`;
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.unionId} = ${unionId}`)
      .limit(1);
    if (found.length > 0) {
      userIdByOwner.set(owner, found[0]!.id);
      continue;
    }
    const inserted = await db
      .insert(users)
      .values({ unionId, name: owner })
      .returning({ id: users.id });
    userIdByOwner.set(owner, inserted[0]!.id);
  }

  const conversationIdMap = new Map<string, number>();
  for (const row of legacyConversations.rows) {
    const userId = userIdByOwner.get(row.owner_id);
    if (!userId) continue;
    const status = ["active", "archived", "closed", "error"].includes(row.status)
      ? (row.status as "active" | "archived" | "closed" | "error")
      : "active";
    const inserted = await db
      .insert(conversations)
      .values({
        userId,
        title: row.title,
        status,
        metadata: { legacyId: row.id },
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      })
      .returning({ id: conversations.id });
    conversationIdMap.set(row.id, inserted[0]!.id);
  }

  let messageCount = 0;
  for (const row of legacyMessages.rows) {
    const conversationId = conversationIdMap.get(row.conversation_id);
    if (!conversationId) continue;
    const role = ["user", "assistant", "system", "tool", "agent"].includes(
      row.role,
    )
      ? (row.role as "user" | "assistant" | "system" | "tool" | "agent")
      : "assistant";
    await db.insert(messages).values({
      conversationId,
      role,
      content: row.content,
      outputKind: row.output_kind,
      ownerId: row.owner_id,
      metadata: { ...row.metadata, legacyId: row.id },
      createdAt: new Date(row.created_at),
    });
    messageCount += 1;
  }

  console.log(
    `backfill complete: ${userIdByOwner.size} users, ${conversationIdMap.size} conversations, ${messageCount} messages`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("backfill failed:", error);
    process.exit(1);
  });
