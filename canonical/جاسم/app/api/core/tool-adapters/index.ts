/**
 * Tool Adapters Index — Barrel Export for All JASIM Tool Adapters
 *
 * All adapters perform REAL operations — no placeholders, no mocks.
 */

// ── LLM Adapter ──────────────────────────────────────────────────────────────
export { executeLLM, type LLMInputs } from "./llm-adapter";

// ── Search Adapter ───────────────────────────────────────────────────────────
export { executeSearch, type SearchInputs, type SearchResult } from "./search-adapter";

// ── Calculator Adapter ────────────────────────────────────────────────────────
export { executeCalculator, type CalculatorInputs, type CalculatorOutput } from "./calculator-adapter";

// ── Database Adapter ───────────────────────────────────────────────────────────
export { executeDatabaseQuery, type DatabaseInputs } from "./database-adapter";

// ── File Adapter ──────────────────────────────────────────────────────────────
export { executeFileRead, executeFileWrite, type FileReadInputs, type FileWriteInputs } from "./file-adapter";

// ── Vision Adapter ────────────────────────────────────────────────────────────
export { executeVision, type VisionInputs, type VisionOutput } from "./vision-adapter";

// ── Calendar Adapter ──────────────────────────────────────────────────────────
export { executeCalendar, type CalendarInputs, type CalendarEvent } from "./calendar-adapter";

// ── Tracking Adapter ──────────────────────────────────────────────────────────
export { executeTracking, type TrackingInputs, type TrackingOutput } from "./tracking-adapter";

// ── HTTP Adapter ─────────────────────────────────────────────────────────────
export { executeHttpRequest, type HttpInputs, type HttpOutput } from "./http-adapter";

// ── Notification Adapter ─────────────────────────────────────────────────────
export { executeNotification, type NotificationInputs } from "./notification-adapter";
