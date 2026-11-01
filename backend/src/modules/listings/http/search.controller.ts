import { Controller, Get, Query } from '@nestjs/common';
import { Public, RateLimit } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { SearchService } from '../services/search.service';
import { SearchQuery } from './search.dto';

// Search (docs/design/03_listings_auctions.pdf sections 3.1 and 7; U3-03). Guests search too (FR-SRC-05); CP-35 limits
// it per source address. Recommendations (GET /recommendations, FR-SRC-06, Could) are not built (Decisions log, U3-03).
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * FR-SRC-01 to FR-SRC-05: words, filters, a sort and a cursor; 20 cards a page with nextCursor, and on the first page
   * up to DV-21 featured matches in `featured` (FR-MON-05). A signed-in user without lat/lng searches from their saved area.
   */
  @Public()
  @RateLimit('search')
  @Get()
  find(@Query() q: SearchQuery, @CurrentPrincipal() p: Principal | undefined) {
    return this.search.search(p?.type === 'user' ? p.userId : undefined, q);
  }
}
