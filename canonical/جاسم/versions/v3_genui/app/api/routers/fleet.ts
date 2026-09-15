import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { drivers, driverAssignments, sosAlerts, orders } from "@db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export const fleetRouter = createRouter({
  // Register driver with vehicle info
  registerDriver: authedQuery
    .input(z.object({
      merchantId: z.number(),
      fullName: z.string().min(1),
      phone: z.string().min(1),
      email: z.string().email().optional(),
      vehicleType: z.enum(["motorcycle", "car", "van", "truck", "bicycle"]).default("car"),
      vehicleModel: z.string().optional(),
      vehiclePlate: z.string().optional(),
      licenseNumber: z.string().optional(),
      commissionRate: z.number().min(0).max(1).default(0.15),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const [driver] = await db.insert(drivers).values({
        ...input,
        userId: Number(userId),
        status: "offline",
        rating: 5.0,
        totalDeliveries: 0,
        totalEarnings: 0,
      }).$returningId();
      return { success: true, driverId: driver.id };
    }),

  // List drivers for merchant
  getDrivers: authedQuery
    .input(z.object({
      merchantId: z.number(),
      status: z.enum(["available", "busy", "offline", "suspended"]).optional(),
      marketCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(drivers.merchantId, input.merchantId)];
      if (input.status) {
        conditions.push(eq(drivers.status, input.status));
      }
      if (input.marketCode) {
        conditions.push(eq(drivers.marketCode, input.marketCode));
      }
      const result = await db.select().from(drivers)
        .where(and(...conditions))
        .orderBy(desc(drivers.createdAt));
      return result;
    }),

  // Update driver GPS location
  updateLocation: authedQuery
    .input(z.object({
      driverId: z.number(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }))
    .mutation(async ({ input }) => {
      const { driverId, lat, lng } = input;
      await db.update(drivers)
        .set({
          currentLat: lat,
          currentLng: lng,
          lastLocationAt: new Date(),
        })
        .where(eq(drivers.id, driverId));
      return { success: true, lat, lng, timestamp: new Date().toISOString() };
    }),

  // Get driver current location
  getLocation: authedQuery
    .input(z.object({
      driverId: z.number(),
    }))
    .query(async ({ input }) => {
      const [driver] = await db.select({
        id: drivers.id,
        fullName: drivers.fullName,
        currentLat: drivers.currentLat,
        currentLng: drivers.currentLng,
        lastLocationAt: drivers.lastLocationAt,
        status: drivers.status,
      }).from(drivers).where(eq(drivers.id, input.driverId)).limit(1);
      return driver || null;
    }),

  // Assign order to driver
  assignOrder: authedQuery
    .input(z.object({
      driverId: z.number(),
      orderId: z.number(),
      merchantId: z.number(),
      estimatedMinutes: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      // Verify order exists
      const [order] = await db.select().from(orders)
        .where(eq(orders.id, input.orderId)).limit(1);
      if (!order) {
        return { success: false, error: "Order not found" };
      }

      // Calculate commission
      const commission = (order.totalAmount || 0) * 0.15;

      const [assignment] = await db.insert(driverAssignments).values({
        driverId: input.driverId,
        orderId: input.orderId,
        merchantId: input.merchantId,
        status: "assigned",
        estimatedMinutes: input.estimatedMinutes,
        commission,
      }).$returningId();

      // Update driver status to busy
      await db.update(drivers)
        .set({ status: "busy" })
        .where(eq(drivers.id, input.driverId));

      return {
        success: true,
        assignmentId: assignment.id,
        commission,
        status: "assigned",
      };
    }),

  // Get optimized route (mock optimization - returns waypoints)
  getRoute: authedQuery
    .input(z.object({
      driverId: z.number(),
      destinationLat: z.number(),
      destinationLng: z.number(),
    }))
    .query(async ({ input }) => {
      const [driver] = await db.select()
        .from(drivers)
        .where(eq(drivers.id, input.driverId))
        .limit(1);

      if (!driver || !driver.currentLat || !driver.currentLng) {
        return { success: false, error: "Driver location unavailable" };
      }

      // Generate mock optimized waypoints
      const startLat = driver.currentLat;
      const startLng = driver.currentLng;
      const endLat = input.destinationLat;
      const endLng = input.destinationLng;

      // Linear interpolation for waypoints (mock routing)
      const waypoints = Array.from({ length: 5 }, (_, i) => ({
        lat: startLat + (endLat - startLat) * ((i + 1) / 6),
        lng: startLng + (endLng - startLng) * ((i + 1) / 6),
        order: i + 1,
      }));

      const distanceKm = Math.sqrt(
        Math.pow(endLat - startLat, 2) + Math.pow(endLng - startLng, 2)
      ) * 111;

      const estimatedMinutes = Math.round(distanceKm * 2 + 5);

      return {
        success: true,
        origin: { lat: startLat, lng: startLng },
        destination: { lat: endLat, lng: endLng },
        waypoints,
        distanceKm: Math.round(distanceKm * 100) / 100,
        estimatedMinutes,
      };
    }),

  // Update driver status (available, busy, offline)
  updateStatus: authedQuery
    .input(z.object({
      driverId: z.number(),
      status: z.enum(["available", "busy", "offline", "suspended"]),
    }))
    .mutation(async ({ input }) => {
      await db.update(drivers)
        .set({ status: input.status })
        .where(eq(drivers.id, input.driverId));
      return { success: true, driverId: input.driverId, status: input.status };
    }),

  // Send SOS alert
  sos: authedQuery
    .input(z.object({
      driverId: z.number(),
      merchantId: z.number(),
      type: z.enum(["accident", "theft", "harassment", "mechanical", "medical", "other"]).default("other"),
      message: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const [alert] = await db.insert(sosAlerts).values({
        driverId: input.driverId,
        merchantId: input.merchantId,
        type: input.type,
        message: input.message || "SOS Alert triggered",
        lat: input.lat,
        lng: input.lng,
        status: "active",
      }).$returningId();

      return {
        success: true,
        alertId: alert.id,
        type: input.type,
        status: "active",
        timestamp: new Date().toISOString(),
      };
    }),

  // Get SOS alerts
  getSos: authedQuery
    .input(z.object({
      merchantId: z.number(),
      status: z.enum(["active", "resolved", "escalated"]).optional(),
      driverId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(sosAlerts.merchantId, input.merchantId)];
      if (input.status) {
        conditions.push(eq(sosAlerts.status, input.status));
      }
      if (input.driverId) {
        conditions.push(eq(sosAlerts.driverId, input.driverId));
      }
      const alerts = await db.select().from(sosAlerts)
        .where(and(...conditions))
        .orderBy(desc(sosAlerts.createdAt));
      return alerts;
    }),

  // Get driver performance metrics
  driverPerformance: authedQuery
    .input(z.object({
      driverId: z.number(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const [driver] = await db.select().from(drivers)
        .where(eq(drivers.id, input.driverId)).limit(1);

      if (!driver) {
        return { success: false, error: "Driver not found" };
      }

      // Get recent assignments
      const assignments = await db.select().from(driverAssignments)
        .where(eq(driverAssignments.driverId, input.driverId))
        .orderBy(desc(driverAssignments.createdAt))
        .limit(100);

      const completed = assignments.filter(a => a.status === "delivered").length;
      const cancelled = assignments.filter(a => a.status === "cancelled").length;
      const totalCommission = assignments.reduce((sum, a) => sum + (a.commission || 0), 0);
      const avgDeliveryTime = assignments
        .filter(a => a.actualMinutes)
        .reduce((sum, a, _, arr) => sum + (a.actualMinutes || 0) / arr.length, 0);

      return {
        success: true,
        driverId: input.driverId,
        fullName: driver.fullName,
        rating: driver.rating,
        totalDeliveries: driver.totalDeliveries,
        totalEarnings: driver.totalEarnings,
        periodDays: input.days,
        recentAssignments: assignments.length,
        completedDeliveries: completed,
        cancelledDeliveries: cancelled,
        completionRate: assignments.length > 0 ? Math.round((completed / assignments.length) * 100) : 0,
        totalCommission: Math.round(totalCommission * 1000) / 1000,
        averageDeliveryMinutes: avgDeliveryTime ? Math.round(avgDeliveryTime) : 0,
        currentStatus: driver.status,
      };
    }),

  // Calculate driver commissions
  commissions: authedQuery
    .input(z.object({
      merchantId: z.number(),
      driverId: z.number().optional(),
      period: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(driverAssignments.merchantId, input.merchantId)];
      if (input.driverId) {
        conditions.push(eq(driverAssignments.driverId, input.driverId));
      }

      const assignments = await db.select().from(driverAssignments)
        .where(and(...conditions))
        .orderBy(desc(driverAssignments.createdAt));

      const deliveredAssignments = assignments.filter(a => a.status === "delivered");
      const totalCommission = deliveredAssignments.reduce((sum, a) => sum + (a.commission || 0), 0);
      const totalOrderValue = deliveredAssignments.reduce((sum, a) => sum + (a.commission || 0) / 0.15, 0);

      // Group by driver
      const byDriver: Record<number, {
        driverId: number;
        deliveries: number;
        commission: number;
        orderValue: number;
      }> = {};

      for (const a of deliveredAssignments) {
        if (!byDriver[a.driverId]) {
          byDriver[a.driverId] = { driverId: a.driverId, deliveries: 0, commission: 0, orderValue: 0 };
        }
        byDriver[a.driverId].deliveries += 1;
        byDriver[a.driverId].commission += a.commission || 0;
        byDriver[a.driverId].orderValue += (a.commission || 0) / 0.15;
      }

      return {
        success: true,
        period: input.period,
        merchantId: input.merchantId,
        summary: {
          totalAssignments: assignments.length,
          completedDeliveries: deliveredAssignments.length,
          totalCommission: Math.round(totalCommission * 1000) / 1000,
          totalOrderValue: Math.round(totalOrderValue * 1000) / 1000,
          averageCommissionPerDelivery: deliveredAssignments.length > 0
            ? Math.round((totalCommission / deliveredAssignments.length) * 1000) / 1000
            : 0,
        },
        byDriver: Object.values(byDriver).map(d => ({
          ...d,
          commission: Math.round(d.commission * 1000) / 1000,
          orderValue: Math.round(d.orderValue * 1000) / 1000,
        })),
      };
    }),
});
