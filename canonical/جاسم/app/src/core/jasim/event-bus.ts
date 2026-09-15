import type { JasimEvent } from './types';

type EventHandler = (event: JasimEvent) => void | Promise<void>;

const subscribers: Map<string, Set<EventHandler>> = new Map();
const eventLog: JasimEvent[] = [];
const MAX_LOG_SIZE = 10000;

export function publish(event: Omit<JasimEvent, 'id' | 'timestamp' | 'handled'>): JasimEvent {
  const fullEvent: JasimEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date(),
    handled: false,
  };

  eventLog.push(fullEvent);
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.shift();
  }

  const handlers = subscribers.get(event.type);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(fullEvent);
      } catch (error) {
        console.error(`Event handler error for ${event.type}:`, error);
      }
    }
  }

  const wildcardHandlers = subscribers.get('*');
  if (wildcardHandlers) {
    for (const handler of wildcardHandlers) {
      try {
        handler(fullEvent);
      } catch (error) {
        console.error(`Wildcard handler error:`, error);
      }
    }
  }

  return { ...fullEvent, handled: true };
}

export function subscribe(eventType: string, handler: EventHandler): () => void {
  if (!subscribers.has(eventType)) {
    subscribers.set(eventType, new Set());
  }
  subscribers.get(eventType)!.add(handler);

  return () => {
    subscribers.get(eventType)?.delete(handler);
  };
}

export function subscribeToEvent(eventType: string, handler: EventHandler): () => void {
  return subscribe(eventType, handler);
}

export function getPendingEvents(): JasimEvent[] {
  return eventLog.filter((e) => !e.handled);
}

export function getEventLog(limit: number = 100): JasimEvent[] {
  return eventLog.slice(-limit);
}

export function clearEventLog(): void {
  eventLog.length = 0;
}

export function getEventsByType(type: string): JasimEvent[] {
  return eventLog.filter((e) => e.type === type);
}

export function getEventsBySource(source: string): JasimEvent[] {
  return eventLog.filter((e) => e.source === source);
}

export function getEventsByTarget(target: string): JasimEvent[] {
  return eventLog.filter((e) => e.target === target);
}
