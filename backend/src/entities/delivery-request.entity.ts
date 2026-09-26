import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Order } from './order.entity';
import { FulfilmentType } from './order.entity';

export enum DeliveryStatus {
  PENDING = 'pending',
  BOOKED = 'booked',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  MEETUP_ARRANGED = 'meetup_arranged',
  CANCELLED = 'cancelled',
}

// FR-50–FR-58. Decision threshold (Appendix B in the SRS): <= 2km suggests
// self-pickup with a safe meetup point; > 2km books a courier at a
// system-quoted blended fare.
@Entity('delivery_requests')
export class DeliveryRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @Column({ type: 'enum', enum: FulfilmentType })
  fulfilmentType: FulfilmentType;

  @Column({ type: 'double precision' })
  distanceKm: number;

  @Column({ nullable: true })
  courierReference?: string;

  @Column({ type: 'enum', enum: DeliveryStatus, default: DeliveryStatus.PENDING })
  status: DeliveryStatus;

  @Column({ nullable: true })
  meetupPoint?: string;
}
