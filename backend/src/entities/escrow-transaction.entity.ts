import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';

export enum EscrowState {
  HELD = 'held',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  FROZEN_DISPUTED = 'frozen_disputed',
}

// FR-PAY-01–FR-PAY-21. `stateHistory` is an append-only audit trail — never mutate
// past entries, only append (supports FR-PAY-15 reconciliation and dispute review).
@Entity('escrow_transactions')
export class EscrowTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @Column({ type: 'enum', enum: EscrowState, default: EscrowState.HELD })
  state: EscrowState;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  stateHistory: Array<{ state: EscrowState; at: string; note?: string }>;
}
