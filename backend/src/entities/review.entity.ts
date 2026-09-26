import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Order } from './order.entity';
import { User } from './user.entity';

// FR-65–FR-68. Directional: buyer-to-seller and seller-to-buyer are separate
// rows, and a review can only be created against a completed, paid Order.
@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  rater: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  ratee: User;

  @Column({ type: 'int' })
  stars: number; // 1–5

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @CreateDateColumn()
  createdAt: Date;
}
