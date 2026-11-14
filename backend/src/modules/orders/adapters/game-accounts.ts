import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GAME_ACCOUNT_PORT, GameAccountPort } from '../../game-accounts/ports';

// GameAccountPort (I-29) is implemented by the Game-Account unit (Unit 5, U5-03), which is built on top of this unit
// and imports it. This unit injects GAME_CHECKOUT; the provider below forwards to Unit 5's port, found on first use.
export const GAME_CHECKOUT = Symbol('GAME_CHECKOUT');

@Injectable()
export class ForwardedGameCheckout implements GameAccountPort {
  constructor(private readonly modules: ModuleRef) {}

  assertCheckoutReady(orderId: string): Promise<void> {
    return this.modules.get<GameAccountPort>(GAME_ACCOUNT_PORT, { strict: false }).assertCheckoutReady(orderId);
  }
}
