import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { Listing } from './listing.entity';
import { User } from './user.entity';

// FR-23–FR-34. Bid placement must go through a row lock on the parent
// auction (see docs/proposal.tex, "Verification") — never trust a client
// timestamp for anti-sniping decisions, only the server clock.
@Entity('bids')
export class Bid {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  listing: Listing;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  bidder: User;

  @Column({ type: 'numeric' })
  amount: string;

  @Column({ default: false })
  isProxy: boolean;

  @Column({ type: 'numeric', nullable: true })
  proxyMax?: string;

  @CreateDateColumn()
  placedAt: Date;
}
