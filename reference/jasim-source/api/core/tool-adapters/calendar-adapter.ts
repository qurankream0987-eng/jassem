/**
 * Calendar Tool Adapter — Event Scheduling & Availability
 *
 * Manages events using the database memory_entries table with category="calendar".
 * Supports CRUD operations on calendar events and availability checks.
 */

import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { memoryEntries } from "@db/schema";
import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface CalendarInputs {
  action: "schedule" | "update" | "cancel" | "list" | "check_availability" | "get_event";
  event?: {
    title: string;
    description?: string;
    startTime: string; // ISO 8601
    endTime: string;   // ISO 8601
    timezone?: string;
    attendees?: string[];
    location?: string;
    recurrence?: string; // e.g. "weekly", "daily", "monthly"
    reminderMinutes?: number[];
  };
  eventId?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  attendeeEmails?: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  timezone: string;
  attendees: string[];
  location?: string;
  recurrence?: string;
  reminderMinutes?: number[];
  createdAt: string;
  status: "scheduled" | "cancelled" | "completed";
}

/**
 * Execute calendar operations.
 */
export async function executeCalendar(
  inputs: CalendarInputs,
  ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();

  try {
    switch (inputs.action) {
      case "schedule":
        return await scheduleEvent(inputs, ctx, start);
      case "update":
        return await updateEvent(inputs, start);
      case "cancel":
        return await cancelEvent(inputs, start);
      case "list":
        return await listEvents(inputs, start);
      case "check_availability":
        return await checkAvailability(inputs, start);
      case "get_event":
        return await getEvent(inputs, start);
      default:
        throw new ToolError(
          ERROR_CODES.VALIDATION_FAILED,
          `Unknown calendar action: ${inputs.action}`,
          "calendar"
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────────────────────────────────────

async function scheduleEvent(
  inputs: CalendarInputs,
  ctx: ExecutionContext,
  start: number
): Promise<ToolResult> {
  const event = inputs.event;
  if (!event || !event.title || !event.startTime || !event.endTime) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Schedule action requires event with title, startTime, and endTime",
      "calendar"
    );
  }

  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Invalid date format. Use ISO 8601 format.",
      "calendar"
    );
  }

  if (endDate <= startDate) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "endTime must be after startTime",
      "calendar"
    );
  }

  // Check for conflicts
  const conflicts = await findConflicts(
    startDate,
    endDate,
    ctx.userId ? Number(ctx.userId) : undefined
  );

  const eventId = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const eventData: CalendarEvent = {
    id: eventId,
    title: event.title,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone || "UTC",
    attendees: event.attendees || [],
    location: event.location,
    recurrence: event.recurrence,
    reminderMinutes: event.reminderMinutes,
    createdAt: new Date().toISOString(),
    status: "scheduled",
  };

  const [result] = await db.insert(memoryEntries).values({
    userId: ctx.userId ? Number(ctx.userId) : undefined,
    scope: "user",
    category: "calendar",
    key: eventId,
    value: eventData,
  });

  // Also create an event entry in the events table for observability
  const { events } = await import("@db/schema");
  await db.insert(events).values({
    type: "calendar.scheduled",
    source: "calendar_tool",
    payload: {
      eventId,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      userId: ctx.userId,
    },
    priority: "normal",
  });

  return {
    success: true,
    output: {
      scheduled: true,
      eventId,
      event: eventData,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      conflictCount: conflicts.length,
      memoryEntryId: Number(result.insertId),
    },
    duration: Date.now() - start,
    sideEffects: ["data_modification"],
  };
}

async function updateEvent(
  inputs: CalendarInputs,
  start: number
): Promise<ToolResult> {
  if (!inputs.eventId) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Update action requires 'eventId'",
      "calendar"
    );
  }

  const existing = await db.query.memoryEntries.findFirst({
    where: and(
      eq(memoryEntries.category, "calendar"),
      eq(memoryEntries.key, inputs.eventId)
    ),
  });

  if (!existing) {
    throw new ToolError(
      ERROR_CODES.NOT_FOUND,
      `Event not found: ${inputs.eventId}`,
      "calendar"
    );
  }

  const currentEvent = (existing.value as Partial<CalendarEvent>) || {};
  const updatedEvent: Partial<CalendarEvent> = {
    ...currentEvent,
    ...(inputs.event?.title && { title: inputs.event.title }),
    ...(inputs.event?.description !== undefined && { description: inputs.event.description }),
    ...(inputs.event?.startTime && { startTime: inputs.event.startTime }),
    ...(inputs.event?.endTime && { endTime: inputs.event.endTime }),
    ...(inputs.event?.timezone && { timezone: inputs.event.timezone }),
    ...(inputs.event?.attendees && { attendees: inputs.event.attendees }),
    ...(inputs.event?.location !== undefined && { location: inputs.event.location }),
    ...(inputs.event?.recurrence !== undefined && { recurrence: inputs.event.recurrence }),
    ...(inputs.event?.reminderMinutes && { reminderMinutes: inputs.event.reminderMinutes }),
  };

  await db
    .update(memoryEntries)
    .set({ value: updatedEvent, updatedAt: new Date() })
    .where(eq(memoryEntries.id, existing.id));

  return {
    success: true,
    output: {
      updated: true,
      eventId: inputs.eventId,
      event: updatedEvent,
    },
    duration: Date.now() - start,
    sideEffects: ["data_modification"],
  };
}

async function cancelEvent(
  inputs: CalendarInputs,
  start: number
): Promise<ToolResult> {
  if (!inputs.eventId) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Cancel action requires 'eventId'",
      "calendar"
    );
  }

  const existing = await db.query.memoryEntries.findFirst({
    where: and(
      eq(memoryEntries.category, "calendar"),
      eq(memoryEntries.key, inputs.eventId)
    ),
  });

  if (!existing) {
    throw new ToolError(
      ERROR_CODES.NOT_FOUND,
      `Event not found: ${inputs.eventId}`,
      "calendar"
    );
  }

  const eventData = (existing.value as Partial<CalendarEvent>) || {};
  eventData.status = "cancelled";

  await db
    .update(memoryEntries)
    .set({ value: eventData, updatedAt: new Date() })
    .where(eq(memoryEntries.id, existing.id));

  return {
    success: true,
    output: {
      cancelled: true,
      eventId: inputs.eventId,
    },
    duration: Date.now() - start,
    sideEffects: ["data_modification"],
  };
}

async function listEvents(
  inputs: CalendarInputs,
  start: number
): Promise<ToolResult> {
  const timeRange = inputs.timeRange;
  let conditions = eq(memoryEntries.category, "calendar") as unknown;

  if (timeRange?.start && timeRange?.end) {
    // Filter by date range in value JSON (best effort via memory query)
    const startDate = new Date(timeRange.start);
    const endDate = new Date(timeRange.end);

    const allEntries = await db.query.memoryEntries.findMany({
      where: eq(memoryEntries.category, "calendar"),
      orderBy: [desc(memoryEntries.createdAt)],
      limit: 500,
    });

    const events = allEntries
      .map((e) => e.value as CalendarEvent)
      .filter((e) => {
        const eventStart = new Date(e.startTime);
        return eventStart >= startDate && eventStart <= endDate;
      });

    return {
      success: true,
      output: {
        events,
        count: events.length,
        timeRange,
      },
      duration: Date.now() - start,
      sideEffects: [],
    };
  }

  const entries = await db.query.memoryEntries.findMany({
    where: conditions as never,
    orderBy: [desc(memoryEntries.createdAt)],
    limit: 100,
  });

  const events = entries.map((e) => e.value as CalendarEvent);

  return {
    success: true,
    output: {
      events,
      count: events.length,
    },
    duration: Date.now() - start,
    sideEffects: [],
  };
}

async function checkAvailability(
  inputs: CalendarInputs,
  start: number
): Promise<ToolResult> {
  const range = inputs.timeRange;
  if (!range?.start || !range?.end) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "check_availability requires timeRange with start and end",
      "calendar"
    );
  }

  const startDate = new Date(range.start);
  const endDate = new Date(range.end);

  const conflicts = await findConflicts(startDate, endDate);

  return {
    success: true,
    output: {
      available: conflicts.length === 0,
      conflicts,
      conflictCount: conflicts.length,
      timeRange: range,
    },
    duration: Date.now() - start,
    sideEffects: [],
  };
}

async function getEvent(
  inputs: CalendarInputs,
  start: number
): Promise<ToolResult> {
  if (!inputs.eventId) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "get_event requires 'eventId'",
      "calendar"
    );
  }

  const entry = await db.query.memoryEntries.findFirst({
    where: and(
      eq(memoryEntries.category, "calendar"),
      eq(memoryEntries.key, inputs.eventId)
    ),
  });

  if (!entry) {
    throw new ToolError(
      ERROR_CODES.NOT_FOUND,
      `Event not found: ${inputs.eventId}`,
      "calendar"
    );
  }

  return {
    success: true,
    output: {
      event: entry.value as CalendarEvent,
    },
    duration: Date.now() - start,
    sideEffects: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict Detection
// ─────────────────────────────────────────────────────────────────────────────

async function findConflicts(
  startDate: Date,
  endDate: Date,
  userId?: number
): Promise<CalendarEvent[]> {
  const conditions = [eq(memoryEntries.category, "calendar")];
  if (userId) {
    conditions.push(eq(memoryEntries.userId, userId) as never);
  }

  const entries = await db.query.memoryEntries.findMany({
    where: and(...conditions),
    limit: 500,
  });

  return entries
    .map((e) => e.value as CalendarEvent)
    .filter((event) => {
      if (event.status === "cancelled") return false;
      const eventStart = new Date(event.startTime);
      const eventEnd = new Date(event.endTime);
      // Check overlap: (StartA < EndB) and (EndA > StartB)
      return eventStart < endDate && eventEnd > startDate;
    });
}
