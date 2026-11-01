import { Injectable } from '@nestjs/common';

// The consumer registry of the outbox dispatcher (DC-6; docs/design/09_integration.pdf section 3.2).
// A unit registers, when its module starts, the events it consumes:  bus.on('identity.kyc.verified',
// 'listings.show-badge', handler). Delivery is at least once, so every handler must be idempotent: it records
// which events it has processed (or its effect is naturally repeatable). A handler that throws is retried
// with the event; the other handlers of the event run anyway and are called again on the retry, which their
// idempotency absorbs.
export interface OutboxEvent {
  /** The outbox the event came from (its schema), and its id there. */
  outbox: string;
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  attempt: number; // 1 on the first delivery
}

export type EventHandler = (e: OutboxEvent) => Promise<void>;

interface Consumer {
  name: string;
  handler: EventHandler;
}

/** "<unit>.<entity>.<past>" (DC-6). */
const EVENT_NAME = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;

@Injectable()
export class EventBus {
  private readonly consumers = new Map<string, Consumer[]>();

  on(eventType: string, consumerName: string, handler: EventHandler): void {
    if (!EVENT_NAME.test(eventType)) throw new Error(`"${eventType}" is not an event name (<unit>.<entity>.<past>)`);
    const list = this.consumers.get(eventType) ?? [];
    if (list.some((c) => c.name === consumerName)) throw new Error(`${consumerName} already consumes ${eventType}`);
    list.push({ name: consumerName, handler });
    this.consumers.set(eventType, list);
  }

  consumersOf(eventType: string): readonly Consumer[] {
    return this.consumers.get(eventType) ?? [];
  }
}
