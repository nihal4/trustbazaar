import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum ListingType {
  FIXED = 'fixed',
  AUCTION = 'auction',
}

export enum ListingStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  SOLD = 'sold',
  UNSOLD = 'unsold', // auction closed, reserve not met
  REMOVED = 'removed',
}

// FR-10–FR-22. Auction-only fields are nullable for fixed-price listings and
// vice versa; consider a check constraint or a discriminated subtype once
// the schema stabilizes.
@Entity('listings')
export class Listing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  seller: User;

  @Column({ type: 'enum', enum: ListingType })
  type: ListingType;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Index()
  @Column()
  category: string;

  @Column()
  condition: string;

  @Column({ type: 'simple-array', default: '' })
  photos: string[];

  // Fixed-price fields
  @Column({ type: 'numeric', nullable: true })
  price?: string;

  @Column({ type: 'int', nullable: true })
  stock?: number;

  // Auction fields
  @Column({ type: 'numeric', nullable: true })
  startingPrice?: string;

  @Column({ type: 'numeric', nullable: true })
  reservePrice?: string;

  @Column({ type: 'timestamptz', nullable: true })
  endTime?: Date;

  @Column({ type: 'double precision', nullable: true })
  latitude?: number;

  @Column({ type: 'double precision', nullable: true })
  longitude?: number;

  @Column({ type: 'enum', enum: ListingStatus, default: ListingStatus.DRAFT })
  status: ListingStatus;

  @CreateDateColumn()
  createdAt: Date;
}
