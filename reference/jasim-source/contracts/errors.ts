/**
 * JASIM — Standard Error Types
 * All errors carry a machine-readable code and a human-readable message.
 */

/**
 * Base error class for all JASIM runtime errors.
 */
export class JasimError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly recoverable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'JasimError';
    this.code = code;
    this.statusCode = statusCode;
    this.recoverable = recoverable;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}

/**
 * Task-related errors.
 */
export class TaskError extends JasimError {
  public readonly taskId?: string;

  constructor(
    code: string,
    message: string,
    taskId?: string,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(code, message, 422, recoverable, details);
    this.name = 'TaskError';
    this.taskId = taskId;
  }
}

/**
 * Agent-related errors.
 */
export class AgentError extends JasimError {
  public readonly agentId?: string;

  constructor(
    code: string,
    message: string,
    agentId?: string,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(code, message, 422, recoverable, details);
    this.name = 'AgentError';
    this.agentId = agentId;
  }
}

/**
 * Capability-related errors.
 */
export class CapabilityError extends JasimError {
  public readonly capabilityId?: string;

  constructor(
    code: string,
    message: string,
    capabilityId?: string,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(code, message, 422, recoverable, details);
    this.name = 'CapabilityError';
    this.capabilityId = capabilityId;
  }
}

/**
 * Tool invocation errors.
 */
export class ToolError extends JasimError {
  public readonly toolId?: string;
  public readonly invocationId?: string;

  constructor(
    code: string,
    message: string,
    toolId?: string,
    invocationId?: string,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(code, message, 502, recoverable, details);
    this.name = 'ToolError';
    this.toolId = toolId;
    this.invocationId = invocationId;
  }
}

/**
 * Approval/permission errors.
 */
export class ApprovalError extends JasimError {
  public readonly approvalId?: string;

  constructor(
    code: string,
    message: string,
    approvalId?: string,
    recoverable: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(code, message, 403, recoverable, details);
    this.name = 'ApprovalError';
    this.approvalId = approvalId;
  }
}

/**
 * Validation errors (input schema, data format, etc.).
 */
export class ValidationError extends JasimError {
  public readonly field?: string;

  constructor(
    code: string,
    message: string,
    field?: string,
    recoverable: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(code, message, 400, recoverable, details);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Not found errors.
 */
export class NotFoundError extends JasimError {
  public readonly resourceType?: string;
  public readonly resourceId?: string;

  constructor(
    resourceType: string,
    resourceId: string,
    details?: Record<string, unknown>
  ) {
    super(
      'NOT_FOUND',
      `${resourceType} with id "${resourceId}" not found.`,
      404,
      false,
      details
    );
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Timeout errors.
 */
export class TimeoutError extends JasimError {
  public readonly duration?: number;

  constructor(
    code: string,
    message: string,
    duration?: number,
    recoverable: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(code, message, 504, recoverable, details);
    this.name = 'TimeoutError';
    this.duration = duration;
  }
}

/**
 * Rate limit errors.
 */
export class RateLimitError extends JasimError {
  public readonly retryAfter?: number;

  constructor(
    code: string,
    message: string,
    retryAfter?: number,
    details?: Record<string, unknown>
  ) {
    super(code, message, 429, true, details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Event system errors.
 */
export class EventError extends JasimError {
  constructor(
    code: string,
    message: string,
    recoverable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(code, message, 500, recoverable, details);
    this.name = 'EventError';
  }
}

/**
 * Bubble/UI generation errors.
 */
export class BubbleError extends JasimError {
  public readonly bubbleId?: string;

  constructor(
    code: string,
    message: string,
    bubbleId?: string,
    recoverable: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(code, message, 500, recoverable, details);
    this.name = 'BubbleError';
    this.bubbleId = bubbleId;
  }
}

// ── Error Code Constants ───────────────────────────────────────────────────

export const ERROR_CODES = {
  // Task errors
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_INVALID_STATUS: 'TASK_INVALID_STATUS',
  TASK_PLANNING_FAILED: 'TASK_PLANNING_FAILED',
  TASK_EXECUTION_FAILED: 'TASK_EXECUTION_FAILED',
  TASK_ALREADY_EXISTS: 'TASK_ALREADY_EXISTS',
  TASK_CANCELLED: 'TASK_CANCELLED',

  // Agent errors
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  AGENT_CREATION_FAILED: 'AGENT_CREATION_FAILED',
  AGENT_EXECUTION_FAILED: 'AGENT_EXECUTION_FAILED',
  AGENT_CAPABILITY_MISSING: 'AGENT_CAPABILITY_MISSING',

  // Capability errors
  CAPABILITY_NOT_FOUND: 'CAPABILITY_NOT_FOUND',
  CAPABILITY_INVALID_INPUT: 'CAPABILITY_INVALID_INPUT',
  CAPABILITY_EXECUTION_FAILED: 'CAPABILITY_EXECUTION_FAILED',
  CAPABILITY_UNAUTHORIZED: 'CAPABILITY_UNAUTHORIZED',

  // Tool errors
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_INVOCATION_FAILED: 'TOOL_INVOCATION_FAILED',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  TOOL_UNAUTHORIZED: 'TOOL_UNAUTHORIZED',
  TOOL_RATE_LIMITED: 'TOOL_RATE_LIMITED',

  // Approval errors
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
  POLICY_VIOLATION: 'POLICY_VIOLATION',

  // Validation errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  INVALID_PARAMETER: 'INVALID_PARAMETER',

  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',

  // Event errors
  EVENT_DELIVERY_FAILED: 'EVENT_DELIVERY_FAILED',
  EVENT_INVALID_TYPE: 'EVENT_INVALID_TYPE',

  // Bubble errors
  BUBBLE_GENERATION_FAILED: 'BUBBLE_GENERATION_FAILED',
  BUBBLE_INVALID_TYPE: 'BUBBLE_INVALID_TYPE',
} as const;
