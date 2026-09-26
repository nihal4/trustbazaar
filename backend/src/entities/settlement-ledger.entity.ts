import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Order } from './order.entity';

// FR-78–FR-86. This is the auditable record referenced throughout the
// proposal's "Evaluation Criteria" — item_price + platform_commission
// + courier_payout + platform_delivery_margin + seller_payout must always
// reconcile against the Order's `total`. Enforce that invariant in the
// settlement service, not just trust it here.
@Entity('settlement_ledgers')
export class SettlementLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @Column({ type: 'numeric' })
  itemPrice: string;

  @Column({ type: 'numeric' })
  platformCommission: string;

  @Column({ type: 'numeric', default: 0 })
  deliveryFee: string;

  @Column({ type: 'numeric', default: 0 })
  courierPayout: string;

  @Column({ type: 'numeric', default: 0 })
  platformDeliveryMargin: string;

  @Column({ type: 'numeric' })
  sellerPayout: string;
}
