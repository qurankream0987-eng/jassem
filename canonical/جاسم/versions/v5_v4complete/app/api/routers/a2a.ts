import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { a2aAgents, a2aListings, a2aTransactions, a2aNegotiations } from "@db/schema";
import { eq, desc, and, or } from "drizzle-orm";

export const a2aRouter = createRouter({
  /** List all agents available for trade (public marketplace view) */
  listAgents: authedQuery
    .input(z.object({
      agentType: z.enum([
        "trading", "negotiation", "customer_service",
        "analytics", "marketing", "custom",
      ]).optional(),
      marketCode: z.string().optional(),
      listedOnly: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.agentType) {
        conditions.push(eq(a2aAgents.agentType, input.agentType));
      }
      if (input?.marketCode) {
        conditions.push(eq(a2aAgents.marketCode, input.marketCode));
      }
      if (input?.listedOnly !== false) {
        conditions.push(eq(a2aAgents.isListed, true));
      }

      const agents = conditions.length > 0
        ? await db.select().from(a2aAgents)
            .where(and(...conditions))
            .orderBy(desc(a2aAgents.reputation))
            .limit(100)
        : await db.select().from(a2aAgents)
            .orderBy(desc(a2aAgents.reputation))
            .limit(100);

      return agents;
    }),

  /** Get details of a specific agent */
  getAgent: authedQuery
    .input(z.object({
      agentId: z.number(),
    }))
    .query(async ({ input }) => {
      const [agent] = await db.select().from(a2aAgents)
        .where(eq(a2aAgents.id, input.agentId))
        .limit(1);

      if (!agent) return null;

      // Get active listing if any
      const [listing] = await db.select().from(a2aListings)
        .where(
          and(
            eq(a2aListings.agentId, input.agentId),
            eq(a2aListings.status, "active"),
          ),
        )
        .limit(1);

      // Get transaction history
      const transactions = await db.select().from(a2aTransactions)
        .where(eq(a2aTransactions.agentId, input.agentId))
        .orderBy(desc(a2aTransactions.createdAt))
        .limit(20);

      return {
        ...agent,
        listing: listing || null,
        transactions,
      };
    }),

  /** List agents owned by the authenticated user */
  listMyAgents: authedQuery
    .query(async ({ ctx }) => {
      const userId = ctx.user!.id;
      const agents = await db.select().from(a2aAgents)
        .where(eq(a2aAgents.ownerId, userId))
        .orderBy(desc(a2aAgents.createdAt));
      return agents;
    }),

  /** Create a listing for an agent (sale, trade, or auction) */
  createListing: authedQuery
    .input(z.object({
      agentId: z.number(),
      listingType: z.enum(["sale", "trade", "auction"]),
      price: z.number().min(0).optional(),
      startingBid: z.number().min(0).optional(),
      tradeFor: z.array(z.string()).optional(),
      description: z.string().optional(),
      expiresAt: z.string().datetime().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;

      // Verify ownership
      const [agent] = await db.select().from(a2aAgents)
        .where(
          and(
            eq(a2aAgents.id, input.agentId),
            eq(a2aAgents.ownerId, userId),
          ),
        )
        .limit(1);

      if (!agent) {
        throw new Error("Agent not found or not owned by you");
      }

      const [listing] = await db.insert(a2aListings).values({
        agentId: input.agentId,
        sellerId: userId,
        listingType: input.listingType,
        price: input.price,
        startingBid: input.startingBid,
        tradeFor: input.tradeFor,
        description: input.description,
        status: "active",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        marketCode: input.marketCode,
      }).$returningId();

      // Mark agent as listed
      await db.update(a2aAgents)
        .set({ isListed: true, listingPrice: input.price || input.startingBid })
        .where(eq(a2aAgents.id, input.agentId));

      return { success: true, listingId: listing.id };
    }),

  /** Purchase an agent */
  buyAgent: authedQuery
    .input(z.object({
      listingId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const buyerId = ctx.user!.id;

      const [listing] = await db.select().from(a2aListings)
        .where(
          and(
            eq(a2aListings.id, input.listingId),
            eq(a2aListings.status, "active"),
          ),
        )
        .limit(1);

      if (!listing) {
        throw new Error("Listing not found or not active");
      }

      if (listing.sellerId === buyerId) {
        throw new Error("Cannot buy your own agent");
      }

      const price = listing.price || 0;

      // Create transaction
      const [transaction] = await db.insert(a2aTransactions).values({
        agentId: listing.agentId,
        listingId: listing.id,
        buyerId,
        sellerId: listing.sellerId,
        transactionType: "purchase",
        amount: price,
        escrowStatus: "holding",
        status: "pending",
        marketCode: listing.marketCode,
      }).$returningId();

      // Mark listing as sold
      await db.update(a2aListings)
        .set({ status: "sold" })
        .where(eq(a2aListings.id, input.listingId));

      // Transfer ownership
      await db.update(a2aAgents)
        .set({
          ownerId: buyerId,
          isListed: false,
          listingPrice: null,
          transactionCount: sql`transactionCount + 1`,
        })
        .where(eq(a2aAgents.id, listing.agentId));

      // Complete the transaction
      await db.update(a2aTransactions)
        .set({ status: "completed", escrowStatus: "released", completedAt: new Date() })
        .where(eq(a2aTransactions.id, transaction.id));

      return {
        success: true,
        transactionId: transaction.id,
        agentId: listing.agentId,
        price,
      };
    }),

  /** Trade agents between two users */
  tradeAgent: authedQuery
    .input(z.object({
      myAgentId: z.number(),
      theirAgentId: z.number(),
      listingId: z.number(),
      tradeDetails: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const myUserId = ctx.user!.id;

      // Verify I own my agent
      const [myAgent] = await db.select().from(a2aAgents)
        .where(
          and(
            eq(a2aAgents.id, input.myAgentId),
            eq(a2aAgents.ownerId, myUserId),
          ),
        )
        .limit(1);

      if (!myAgent) {
        throw new Error("You do not own the specified agent");
      }

      // Get their agent
      const [theirAgent] = await db.select().from(a2aAgents)
        .where(eq(a2aAgents.id, input.theirAgentId))
        .limit(1);

      if (!theirAgent) {
        throw new Error("Target agent not found");
      }

      const theirUserId = theirAgent.ownerId;

      // Create trade transaction
      const [transaction] = await db.insert(a2aTransactions).values({
        agentId: input.theirAgentId,
        listingId: input.listingId,
        buyerId: myUserId,
        sellerId: theirUserId,
        transactionType: "trade",
        amount: 0,
        tradeDetails: {
          offeredAgentId: input.myAgentId,
          receivedAgentId: input.theirAgentId,
          ...input.tradeDetails,
        },
        escrowStatus: "holding",
        status: "completed",
        completedAt: new Date(),
        marketCode: theirAgent.marketCode || "KW",
      }).$returningId();

      // Swap ownership
      await db.update(a2aAgents)
        .set({ ownerId: theirUserId, transactionCount: sql`transactionCount + 1` })
        .where(eq(a2aAgents.id, input.myAgentId));

      await db.update(a2aAgents)
        .set({ ownerId: myUserId, isListed: false, listingPrice: null, transactionCount: sql`transactionCount + 1` })
        .where(eq(a2aAgents.id, input.theirAgentId));

      // Update listing
      await db.update(a2aListings)
        .set({ status: "sold" })
        .where(eq(a2aListings.id, input.listingId));

      return {
        success: true,
        transactionId: transaction.id,
        tradedAgentId: input.theirAgentId,
      };
    }),

  /** Negotiate price for an agent listing */
  negotiate: authedQuery
    .input(z.object({
      listingId: z.number(),
      offeredPrice: z.number().min(0),
      message: z.string().optional(),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const buyerId = ctx.user!.id;

      const [listing] = await db.select().from(a2aListings)
        .where(
          and(
            eq(a2aListings.id, input.listingId),
            eq(a2aListings.status, "active"),
          ),
        )
        .limit(1);

      if (!listing) {
        throw new Error("Listing not found or not active");
      }

      if (listing.sellerId === buyerId) {
        throw new Error("Cannot negotiate on your own listing");
      }

      const initialPrice = listing.price || listing.startingBid || listing.currentBid || 0;

      const messages = input.message
        ? [{ role: "buyer", content: input.message, timestamp: new Date().toISOString() }]
        : [];

      const [negotiation] = await db.insert(a2aNegotiations).values({
        listingId: listing.id,
        buyerId,
        sellerId: listing.sellerId,
        initialPrice,
        offeredPrice: input.offeredPrice,
        messages,
        status: "pending",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        marketCode: listing.marketCode,
      }).$returningId();

      return {
        success: true,
        negotiationId: negotiation.id,
        initialPrice,
        offeredPrice: input.offeredPrice,
        status: "pending",
      };
    }),

  /** Get transaction history for a user */
  getTransactions: authedQuery
    .input(z.object({
      agentId: z.number().optional(),
      type: z.enum(["purchase", "trade", "auction_win"]).optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const conditions = [
        or(
          eq(a2aTransactions.buyerId, userId),
          eq(a2aTransactions.sellerId, userId),
        ),
      ];

      if (input?.agentId) {
        conditions.push(eq(a2aTransactions.agentId, input.agentId));
      }
      if (input?.type) {
        conditions.push(eq(a2aTransactions.transactionType, input.type));
      }

      const transactions = conditions.length > 1
        ? await db.select().from(a2aTransactions)
            .where(and(...conditions))
            .orderBy(desc(a2aTransactions.createdAt))
            .limit(input?.limit || 50)
        : await db.select().from(a2aTransactions)
            .where(
              or(
                eq(a2aTransactions.buyerId, userId),
                eq(a2aTransactions.sellerId, userId),
              ),
            )
            .orderBy(desc(a2aTransactions.createdAt))
            .limit(input?.limit || 50);

      return transactions;
    }),
});
