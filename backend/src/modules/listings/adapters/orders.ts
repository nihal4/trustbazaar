import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { EntityManager } from 'typeorm';
import { ORDERS_PORT, OrdersPort, OrderView } from '../../orders/ports';

// OrdersPort (Unit 2 section 3.3) for the auction closer and second-chance offers (U3-05). Unit 2 is built on this
// unit (it imports ListingsModule for the stock port), so this unit cannot import Unit 2's module: the provider
// below finds Unit 2's port on first use, as Unit 1 reaches Unit 6's notifications (Decisions log, U6-05 and U3-05).
export const AUCTION_ORDERS = Symbol('AUCTION_ORDERS');

export type AuctionOrders = Pick<OrdersPort, 'createAuctionOrder'>;

@Injectable()
export class ForwardedAuctionOrders implements AuctionOrders {
  constructor(private readonly modules: ModuleRef) {}

  createAuctionOrder(a: { listingId: string; winnerId: string; price: bigint; kind: 'auction' | 'second_chance' }, tx?: EntityManager): Promise<OrderView> {
    return this.modules.get<OrdersPort>(ORDERS_PORT, { strict: false }).createAuctionOrder(a, tx);
  }
}
