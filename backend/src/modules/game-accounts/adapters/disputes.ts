import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { DISPUTE_COMMANDS, DisputeCommands, DisputeType } from '../../trust/ports';

// DisputeCommands is implemented by Unit 7, which imports this unit (its queues read Unit 5's ownership proofs). This
// unit injects GAME_DISPUTES; the provider below forwards to Unit 7's port, found on first use (as Unit 6 does).
export const GAME_DISPUTES = Symbol('GAME_DISPUTES');

@Injectable()
export class ForwardedDisputes implements DisputeCommands {
  constructor(private readonly modules: ModuleRef) {}

  open(o: { orderId: string; type: DisputeType; description: string; by: 'buyer' | 'system' }, tx: EntityManager): Promise<string> {
    return this.modules.get<DisputeCommands>(DISPUTE_COMMANDS, { strict: false }).open(o, tx);
  }
}
