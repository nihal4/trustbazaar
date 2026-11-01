import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

// ScreeningService (FR-LST-11; docs/design/03_listings_auctions.pdf section 6.1). At publication the title
// and description are matched against listings.screening_terms, lower case, in Bangla or English; a match
// holds the listing for review instead of publishing it. The matched terms are kept for the operators
// (status history) and never shown to the seller, so the list cannot be probed word by word.

/** One form for matching: NFC, lower case, every run of white space a single space. */
export const normaliseForScreening = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ');

@Injectable()
export class ScreeningService {
  async matches(m: EntityManager, title: string, description: string): Promise<{ term: string; severity: string }[]> {
    const text = normaliseForScreening(`${title} ${description}`);
    return m.query(
      `SELECT term, severity FROM listings.screening_terms WHERE strpos($1, lower(term)) > 0 ORDER BY severity, term`,
      [text],
    );
  }
}
