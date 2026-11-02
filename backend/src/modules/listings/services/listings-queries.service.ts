import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { Listing } from '../db/entities';
import type { ListingsQueries, ListingStatus } from '../ports';

// ListingsQueries (docs/design/09_integration.pdf section 4; I-61): what other units may read about a listing,
// through this port only (DC-1). threadFacts for Unit 6's chat (U6-02); fulfilmentFacts for Unit 4 comes with U3-06.
@Injectable()
export class ListingsQueriesService implements ListingsQueries {
  constructor(private readonly db: DataSource) {}

  async threadFacts(listingId: string): Promise<{ sellerId: string; title: string; status: ListingStatus }> {
    const l = await this.db.getRepository(Listing).findOne({ where: { id: listingId }, select: { sellerId: true, title: true, status: true } });
    if (!l) throw new Problem('not-found');
    return { sellerId: l.sellerId, title: l.title, status: l.status };
  }
}
