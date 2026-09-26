import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Listing } from './listing.entity';
import { User } from './user.entity';

export enum FulfilmentType {
  SELF_PICKUP = 'self_pickup',
  COURIER = 'courier',
}

export enum OrderStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  FULFILLED = 'fulfilled',
  COMPLETED = 'completed',
  DISPUTED = 'disputed',
  CANCELLED = 'cancelled',
}

// FR-35–FR-49. One Order has exactly one EscrowTransaction and exactly one
// SettlementLedger entry; at most one DeliveryRequest and at most one Dispute.
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Listing, { onDelete: 'RESTRICT' })
  listing: Listing;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  buyer: User;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  seller: User;

  @Column({ type: 'numeric' })
  itemPrice: string;

  @Column({ type: 'numeric', default: 0 })
  deliveryFee: string;

  @Column({ type: 'numeric' })
  total: string;

  @Column({ type: 'enum', enum: FulfilmentType })
  fulfilmentType: FulfilmentType;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING_PAYMENT })
  status: OrderStatus;

  @CreateDateColumn()
  createdAt: Date;
}
