import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Listing } from './listing.entity';

// FR-MON-01–FR-MON-10 (Could Have — boosted/featured listings).
@Entity('featured_listings')
export class FeaturedListing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Listing, { onDelete: 'CASCADE' })
  @JoinColumn()
  listing: Listing;

  @Column({ type: 'timestamptz' })
  startAt: Date;

  @Column({ type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'numeric' })
  feePaid: string;
}
