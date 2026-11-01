// The split (docs/design/02_orders_payments.pdf section 4.4; FR-PAY-11, FR-PAY-14, FR-MON-01, FR-DLV-13).
// The same rules as the reference function payments.split in the database; a test compares the two on
// random inputs. Every part is integer poisha, and the parts always add up to item price + delivery fee.
export interface Split {
  commission: bigint;
  courierPayout: bigint;
  deliveryMargin: bigint;
  sellerPayout: bigint;
  refundTotal: bigint;
}

export function split(itemPrice: bigint, deliveryFee: bigint, itemRefund: bigint, courierDone: boolean, commissionBps: number, marginBps: number): Split {
  if (itemRefund < 0n || itemRefund > itemPrice) throw new RangeError(`item refund ${itemRefund} out of range 0..${itemPrice}`);
  const released = itemPrice - itemRefund; // 1. a refund comes from the item price first
  const commission = (released * BigInt(commissionBps) + 5000n) / 10000n; // 2. half-up to the poisha
  let deliveryMargin = 0n;
  let courierPayout = 0n;
  let refundTotal = itemRefund + deliveryFee; // 3. the courier never picked up: the whole fee goes back
  if (courierDone) {
    deliveryMargin = (deliveryFee * BigInt(marginBps) + 5000n) / 10000n;
    courierPayout = deliveryFee - deliveryMargin;
    refundTotal = itemRefund;
  }
  return { commission, courierPayout, deliveryMargin, sellerPayout: released - commission, refundTotal }; // 4. the remainder, last
}
