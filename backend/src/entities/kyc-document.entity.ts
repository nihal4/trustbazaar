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

// FR-ACC-01–FR-ACC-11, FR-KYC-01–FR-KYC-12. `encryptedFileRef` must never be a publicly guessable URL —
// serve via short-lived signed URLs only (SEC-DAT-02, SEC-DAT-04).
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
