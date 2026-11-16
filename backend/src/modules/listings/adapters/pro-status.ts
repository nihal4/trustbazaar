import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { PRO_STATUS, ProStatusQuery } from '../../orders/ports';

// ProStatusQuery (Unit 2 section 3.3; U2-06) for the CP-28 listing limit (FR-LST-09, FR-MON-08). Unit 2 imports this
// unit, so the port is found on first use, as for the auction orders (adapters/orders.ts).
export const LISTING_PRO_STATUS = Symbol('LISTING_PRO_STATUS');

@Injectable()
export class ForwardedProStatus implements ProStatusQuery {
  constructor(private readonly modules: ModuleRef) {}

  isPro(userId: string, tx?: EntityManager): Promise<boolean> {
    return this.modules.get<ProStatusQuery>(PRO_STATUS, { strict: false }).isPro(userId, tx);
  }
}
