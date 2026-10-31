import { Provider } from '@nestjs/common';

// DC-10: only the server clock is trusted, and services receive it injected, so deadlines can be
// tested without waiting. Inject with @Inject(CLOCK) clock: Clock.
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };

export const clockProvider: Provider = { provide: CLOCK, useValue: systemClock };
