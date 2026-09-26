import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum KycReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// FR-1–FR-9. `encryptedFileRef` must never be a publicly guessable URL —
// serve via short-lived signed URLs only (NFR-4).
@Entity('kyc_documents')
export class KycDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  documentType: string; // e.g. 'nid', 'passport'

  @Column()
  encryptedFileRef: string;

  @Column({ type: 'enum', enum: KycReviewStatus, default: KycReviewStatus.PENDING })
  reviewStatus: KycReviewStatus;

  @Column({ nullable: true })
  reviewedBy?: string; // operator user id

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
