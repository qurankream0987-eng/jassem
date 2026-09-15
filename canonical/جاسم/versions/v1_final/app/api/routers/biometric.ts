import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { biometricEnrollments } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Simulated biometric template hashing (in production, use proper crypto)
function hashTemplate(type: string, data: string): string {
  const encoder = new TextEncoder();
  const combined = `${type}:${data}:${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

// Simulated liveness detection score
function checkLivenessScore(type: string, sampleData: string): {
  isLive: boolean;
  score: number;
  confidence: number;
  checks: Record<string, boolean>;
} {
  // Mock liveness checks - in production this uses AI models
  const checks: Record<string, boolean> = {
    depthAnalysis: type === "face" ? sampleData.length > 100 : true,
    textureAnalysis: sampleData.length > 50,
    motionConsistency: type === "face" || type === "iris",
    spoofDetection: !sampleData.includes("spoof") && !sampleData.includes("fake"),
    challengeResponse: type === "face" || type === "fingerprint",
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.values(checks).length;
  const score = passedChecks / totalChecks;
  const confidence = 0.7 + (score * 0.28) + (Math.random() * 0.02);

  return {
    isLive: score >= 0.6,
    score: Math.round(score * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    checks,
  };
}

// Calculate similarity between two templates (mock)
function calculateSimilarity(template1: string, template2: string): number {
  // In production, this uses proper biometric comparison algorithms
  let matches = 0;
  const len = Math.min(template1.length, template2.length);
  for (let i = 0; i < len; i++) {
    if (template1[i] === template2[i]) matches++;
  }
  return Math.round((matches / (len || 1)) * 100) / 100;
}

export const biometricRouter = createRouter({
  // Register biometric (face/touch)
  register: authedQuery
    .input(z.object({
      type: z.enum(["face", "fingerprint", "iris", "voice"]),
      templateData: z.string().min(1), // Base64-encoded biometric template
      livenessCheck: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user.id);

      // Perform liveness check
      const liveness = checkLivenessScore(input.type, input.templateData);
      if (input.livenessCheck && !liveness.isLive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Liveness check failed. Possible spoofing detected.",
        });
      }

      // Check if enrollment already exists
      const existing = await db.select()
        .from(biometricEnrollments)
        .where(
          and(
            eq(biometricEnrollments.userId, userId),
            eq(biometricEnrollments.type, input.type),
          ),
        )
        .limit(1);

      const templateHash = hashTemplate(input.type, input.templateData);

      if (existing.length > 0) {
        // Update existing enrollment
        await db.update(biometricEnrollments)
          .set({
            templateHash,
            templateData: input.templateData,
            livenessScore: liveness.confidence,
            isVerified: liveness.isLive,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(biometricEnrollments.id, existing[0].id));

        return {
          success: true,
          enrollmentId: existing[0].id,
          type: input.type,
          liveness,
          message: "Biometric template updated successfully",
        };
      }

      // Create new enrollment
      const [enrollment] = await db.insert(biometricEnrollments).values({
        userId,
        type: input.type,
        templateHash,
        templateData: input.templateData,
        livenessScore: liveness.confidence,
        isVerified: liveness.isLive,
        isActive: true,
      }).$returningId();

      return {
        success: true,
        enrollmentId: enrollment.id,
        type: input.type,
        liveness,
        message: "Biometric enrolled successfully",
      };
    }),

  // Verify biometric
  verify: authedQuery
    .input(z.object({
      type: z.enum(["face", "fingerprint", "iris", "voice"]),
      templateData: z.string().min(1),
      threshold: z.number().min(0).max(1).default(0.85),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = Number(ctx.user.id);

      // Get enrolled template
      const [enrollment] = await db.select()
        .from(biometricEnrollments)
        .where(
          and(
            eq(biometricEnrollments.userId, userId),
            eq(biometricEnrollments.type, input.type),
            eq(biometricEnrollments.isActive, true),
          ),
        )
        .limit(1);

      if (!enrollment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No ${input.type} enrollment found for user`,
        });
      }

      // Calculate similarity
      const similarity = calculateSimilarity(
        enrollment.templateHash,
        hashTemplate(input.type, input.templateData),
      );

      const isMatch = similarity >= input.threshold;

      if (isMatch) {
        await db.update(biometricEnrollments)
          .set({
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(biometricEnrollments.id, enrollment.id));
      } else {
        await db.update(biometricEnrollments)
          .set({
            spoofAttempts: (enrollment.spoofAttempts || 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(biometricEnrollments.id, enrollment.id));
      }

      return {
        success: true,
        verified: isMatch,
        similarity: Math.round(similarity * 100) / 100,
        threshold: input.threshold,
        type: input.type,
        confidence: enrollment.livenessScore,
        attempts: isMatch ? 0 : (enrollment.spoofAttempts || 0) + 1,
        remainingAttempts: isMatch ? undefined : Math.max(0, 5 - ((enrollment.spoofAttempts || 0) + 1)),
      };
    }),

  // Anti-spoofing liveness check
  checkLiveness: authedQuery
    .input(z.object({
      type: z.enum(["face", "fingerprint", "iris", "voice"]),
      sampleData: z.string().min(1),
    }))
    .mutation(({ input }) => {
      const result = checkLivenessScore(input.type, input.sampleData);

      return {
        success: true,
        isLive: result.isLive,
        score: result.score,
        confidence: result.confidence,
        passed: result.isLive,
        checks: result.checks,
        recommendations: result.isLive
          ? []
          : ["Ensure good lighting", "Look directly at camera", "Remove glasses/hat", "Avoid photos/screens"],
      };
    }),

  // Get biometric enrollment status
  getStatus: authedQuery
    .query(async ({ ctx }) => {
      const userId = Number(ctx.user.id);

      const enrollments = await db.select()
        .from(biometricEnrollments)
        .where(eq(biometricEnrollments.userId, userId))
        .orderBy(desc(biometricEnrollments.enrolledAt));

      const types = ["face", "fingerprint", "iris", "voice"] as const;
      const statusMap = types.map(type => {
        const enrollment = enrollments.find(e => e.type === type);
        return {
          type,
          enrolled: !!enrollment,
          verified: enrollment?.isVerified || false,
          active: enrollment?.isActive || false,
          livenessScore: enrollment?.livenessScore,
          lastVerifiedAt: enrollment?.lastVerifiedAt,
          enrolledAt: enrollment?.enrolledAt,
          spoofAttempts: enrollment?.spoofAttempts || 0,
        };
      });

      return {
        userId,
        totalEnrollments: enrollments.length,
        enrolledTypes: enrollments.map(e => e.type),
        status: statusMap,
        fullyVerified: statusMap.every(s => s.verified),
        anyActive: statusMap.some(s => s.active),
      };
    }),

  // List enrollments (admin)
  listEnrollments: authedQuery
    .input(z.object({
      userId: z.number().optional(),
      type: z.enum(["face", "fingerprint", "iris", "voice"]).optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.userId) {
        conditions.push(eq(biometricEnrollments.userId, input.userId));
      }
      if (input?.type) {
        conditions.push(eq(biometricEnrollments.type, input.type));
      }
      if (input?.isActive !== undefined) {
        conditions.push(eq(biometricEnrollments.isActive, input.isActive));
      }

      const enrollments = conditions.length > 0
        ? await db.select().from(biometricEnrollments).where(and(...conditions))
        : await db.select().from(biometricEnrollments);

      return enrollments;
    }),

  // Deactivate enrollment
  deactivate: authedQuery
    .input(z.object({
      enrollmentId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.update(biometricEnrollments)
        .set({ isActive: false })
        .where(eq(biometricEnrollments.id, input.enrollmentId));
      return { success: true, enrollmentId: input.enrollmentId, active: false };
    }),
});
