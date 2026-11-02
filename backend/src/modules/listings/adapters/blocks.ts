import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { BLOCK_PORT, BlockPort } from '../../chat/ports';

// BlockPort (Unit 6, FR-CHT-08) for bids and second-chance acceptances (I-38; U6-02). Unit 6 imports this unit
// (ListingsQueries for threads), so this unit cannot import Unit 6's module: the provider below finds Unit 6's port
// on first use, as AUCTION_ORDERS does for Unit 2 (Decisions log, U3-05 and U6-02).
export const AUCTION_BLOCKS = Symbol('AUCTION_BLOCKS');

@Injectable()
export class ForwardedBlocks implements BlockPort {
  constructor(private readonly modules: ModuleRef) {}

  assertNotBlocked(sellerId: string, buyerId: string, tx?: EntityManager): Promise<void> {
    return this.modules.get<BlockPort>(BLOCK_PORT, { strict: false }).assertNotBlocked(sellerId, buyerId, tx);
  }
}
