export const ZONES = ['inside_dhaka', 'dhaka_suburbs', 'outside_dhaka'] as const;

export type Zone = (typeof ZONES)[number];

export const KINDS = ['police_station', 'shopping_mall', 'bank_branch', 'other_public'] as const;

export type Kind = (typeof KINDS)[number];

export interface Game {
  id: number;
  slug: string;
  name: string;
  platforms: string[];
  codePlacement: string;
  publisherNote: string;
}

export interface Area {
  id: number;
  district: string;
  nameEn: string;
  nameBn: string;
  zone: Zone;
  lat: number;
  lng: number;
  active: boolean;
}

export interface Point {
  id: string;
  kind: Kind;
  nameEn: string;
  nameBn: string;
  district: string;
  lat: number;
  lng: number;
  guidance: string | null;
  active: boolean;
}

export interface FareTable {
  version: number;
  effectiveFrom: string;
  source: string;
  rows: FareRow[];
}

interface FareRow {
  zone: Zone;
  upTo1kg: string;
  upTo2kg: string;
  perExtraKg: string;
}
