import type { IdentityCryptoPort } from '../../identity/ports';
import { contextOf, type AddressLines } from './address.service';

// A shipment keeps its own copies of the two addresses (docs/design/04_delivery.pdf section 7.1): re-encrypted under
// the shipment's row id, because a ciphertext copied from another row does not decrypt (associated data).
export type ShipmentColumn = 'pickup_address_enc' | 'dropoff_address_enc';
export const shipmentContext = (shipmentId: string, column: ShipmentColumn) => `delivery.shipments.${column}:${shipmentId}`;

export async function openSaved(crypto: IdentityCryptoPort, addressId: string, sealed: Buffer): Promise<AddressLines> {
  return JSON.parse(await crypto.decrypt(sealed, contextOf(addressId))) as AddressLines;
}

export async function sealForShipment(crypto: IdentityCryptoPort, shipmentId: string, column: ShipmentColumn, lines: AddressLines): Promise<Buffer> {
  return Buffer.from(await crypto.encrypt(JSON.stringify(lines), shipmentContext(shipmentId, column)));
}

export async function openShipment(crypto: IdentityCryptoPort, shipmentId: string, column: ShipmentColumn, sealed: Buffer): Promise<AddressLines> {
  return JSON.parse(await crypto.decrypt(sealed, shipmentContext(shipmentId, column))) as AddressLines;
}
