import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { SavedPaymentMethod } from '../db/entities';

// The buyer's default payment method (U10-23, Decisions log): one masked label a user, shown again in the payment sheet. The card number, the
// security code, the wallet PIN and a full wallet number never reach the server; only the kind, a card's brand and the last four digits do.
export interface SavedMethodView {
  kind: 'card' | 'bkash' | 'nagad';
  brand: string | null;
  last4: string;
}
type MethodInput = { kind: 'card' | 'bkash' | 'nagad'; brand?: string | null; last4: string };

@Injectable()
export class PaymentMethodService {
  constructor(private readonly db: DataSource) {}

  async get(userId: string): Promise<SavedMethodView | null> {
    const r = await this.db.getRepository(SavedPaymentMethod).findOneBy({ userId });
    return r && r.clearedAt === null ? { kind: r.kind, brand: r.brand, last4: r.last4 } : null;
  }

  async set(userId: string, m: MethodInput): Promise<SavedMethodView> {
    if (m.kind !== 'card' && m.brand) throw new Problem('validation-failed', { errors: [{ field: 'brand', reason: 'card-only' }] });
    await this.db.query(
      `INSERT INTO payments.saved_payment_methods (user_id, kind, brand, last4) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET kind = $2, brand = $3, last4 = $4, updated_at = now(), cleared_at = NULL`,
      [userId, m.kind, m.kind === 'card' ? (m.brand ?? null) : null, m.last4],
    );
    return (await this.get(userId))!;
  }

  async clear(userId: string): Promise<void> {
    await this.db.query(`UPDATE payments.saved_payment_methods SET cleared_at = now(), updated_at = now() WHERE user_id = $1 AND cleared_at IS NULL`, [userId]);
  }
}
