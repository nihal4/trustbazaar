// The identifier of a device (a phone's IMEI, a laptop's serial number) kept for the meetup check (U10-23, Decisions log): a seller gives it when listing, and
// only its last four characters are shown; what is kept is a keyed hash, so the full number is never stored. At the meetup the buyer types the number the
// device shows (*#06# on a phone) and the server compares hashes. The key is derived from the handover key with its own label.
import { createHmac } from 'crypto';

/** Spaces and dashes are dropped, letters are upper case: "35-209900 176148 1" and "352099001761481" are the same number. */
export const normaliseDeviceId = (value: string): string => value.replace(/[\s-]/g, '').toUpperCase();

/** A usable identifier: 6 to 30 letters and digits once normalised. */
export const isDeviceId = (value: string): boolean => /^[A-Z0-9]{6,30}$/.test(normaliseDeviceId(value));

export const deviceDigest = (key: string, value: string): Buffer => createHmac('sha256', `${key}:device-identifier`).update(normaliseDeviceId(value)).digest();

export const deviceLast4 = (value: string): string => normaliseDeviceId(value).slice(-4);
