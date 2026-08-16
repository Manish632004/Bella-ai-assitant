import { ProactiveEvent, ProactiveCategory } from "./types";

type EventHandler<T = unknown> = (event: ProactiveEvent<T>) => void | Promise<void>;

export class EventBus {
  private static instance: EventBus;
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private globalHandlers = new Set<EventHandler<any>>();

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  public subscribeGlobal(handler: EventHandler<any>): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  public emit<T = unknown>(type: string, category: ProactiveCategory, payload: T): void {
    const event: ProactiveEvent<T> = {
      id: Math.random().toString(36).substring(2, 11),
      type,
      category,
      payload,
      timestamp: new Date().toISOString(),
    };

    // Specific handlers
    const specific = this.handlers.get(type);
    if (specific) {
      for (const h of specific) {
        try {
          void h(event);
        } catch (err) {
          console.error(`[EventBus] Error in handler for ${type}:`, err);
        }
      }
    }

    // Global handlers
    for (const h of this.globalHandlers) {
      try {
        void h(event);
      } catch (err) {
        console.error(`[EventBus] Error in global handler for ${type}:`, err);
      }
    }
  }
}
