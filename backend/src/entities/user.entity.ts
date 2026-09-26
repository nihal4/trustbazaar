import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum KycStatus {
  UNVERIFIED = 'unverified',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum UserRole {
  STANDARD = 'standard',
  PRO = 'pro',
  OPERATOR = 'operator', // restricted to KYC review + dispute adjudication only — see SRS 2.4/2.6
}

// Matches SRS Chapter "Data Model Overview" -> Core Entities -> User.
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ nullable: true })
  phone?: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.UNVERIFIED })
  kycStatus: KycStatus;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.STANDARD })
  role: UserRole;

  @Column({ type: 'double precision', nullable: true })
  latitude?: number;

  @Column({ type: 'double precision', nullable: true })
  longitude?: number;

  @CreateDateColumn()
  createdAt: Date;
}
