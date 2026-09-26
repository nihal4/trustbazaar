import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { User } from './user.entity';

export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
}

// FR-69–FR-73. Opening a dispute must freeze the associated
// EscrowTransaction (set state = FROZEN_DISPUTED) — enforce this as a
// transactional side effect in the disputes service, not as a manual step.
@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  openedBy: User;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'simple-array', default: '' })
  evidence: string[];

  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.OPEN })
  status: DisputeStatus;

  @Column({ type: 'text', nullable: true })
  resolution?: string;

  @Column({ nullable: true })
  resolvedBy?: string; // operator user id

  @CreateDateColumn()
  createdAt: Date;
}
