import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  ManyToMany,
  JoinTable,
  CreateDateColumn,
} from 'typeorm';
import { Listing } from './listing.entity';
import { User } from './user.entity';

// FR-59–FR-64. A thread is scoped to one listing and its two participants.
@Entity('chat_threads')
export class ChatThread {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Listing, { onDelete: 'CASCADE' })
  listing: Listing;

  @ManyToMany(() => User)
  @JoinTable()
  participants: User[];

  @CreateDateColumn()
  createdAt: Date;
}
