import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import { Public, RateLimit, SignedIn, Verified } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { ListingService } from '../services/listing.service';
import { MAX_PHOTO_BYTES, STORAGE_KEY } from '../services/media';
import {
  ClarificationDto, CreateListingDto, MyListingsQuery, PhotoQuery, PhotoUploadDto, PublishListingDto, UpdateListingDto,
} from './listings.dto';

// The listings API of Unit 3 (docs/design/03_listings_auctions.pdf section 3.1), U3-02. The design's
// "Seller" policy is SignedIn here plus the ownership check in ListingService, which answers not-found for
// another user's listing (SEC-SDL-09). Staff review and removal are U3-08; search is U3-03.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p.userId;
};
/** A malformed id names no listing: not-found, as for an unknown one. */
const Id = (name: string) => Param(name, new ParseUUIDPipe({ version: '4', exceptionFactory: () => new Problem('not-found') }));

@Controller('categories')
export class CategoriesController {
  constructor(private readonly listings: ListingService) {}

  /** FR-LST-10: the category tree in Bangla and English; prohibited ones are shown as not selectable. */
  @Public()
  @Get()
  categories() {
    return this.listings.categories();
  }
}

@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingService) {}

  /** FR-LST-01 to FR-LST-06: a new draft. A repeat with the same Idempotency-Key answers 200 with the same draft (I-53). */
  @Verified('list')
  @RateLimit('listing-create')
  @Post()
  async create(
    @Body() dto: CreateListingDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { listing, repeated } = await this.listings.create(userOf(p), dto, key);
    res.status(repeated ? 200 : 201);
    return listing;
  }

  /** FR-LST-07: edit a draft, or an active listing before its first bid or order. */
  @SignedIn()
  @Patch(':id')
  update(@Id('id') id: string, @Body() dto: UpdateListingDto, @CurrentPrincipal() p: Principal) {
    return this.listings.update(userOf(p), id, dto);
  }

  /** Section 6.2: multipart, the image in the part "photo", and "showsDefects" ("true" or "false"). */
  @SignedIn()
  @RateLimit('listing-photo')
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 2, fieldSize: 16, parts: 3 } }))
  addPhoto(
    @Id('id') id: string,
    @Body() dto: PhotoUploadDto,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.listings.addPhoto(userOf(p), id, file?.buffer, dto.showsDefects === 'true');
  }

  @SignedIn()
  @Delete(':id/photos/:pid')
  @HttpCode(204)
  async removePhoto(@Id('id') id: string, @Id('pid') pid: string, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.listings.removePhoto(userOf(p), id, pid);
  }

  /** FR-LST-11, FR-LST-12: publish, or hold for review (a screening match or a game account). */
  @Verified('list')
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Id('id') id: string, @Body() dto: PublishListingDto, @CurrentPrincipal() p: Principal) {
    return this.listings.publish(userOf(p), id, dto);
  }

  /** FR-LST-07: a time-stamped clarification below the description. */
  @SignedIn()
  @Post(':id/clarifications')
  clarify(@Id('id') id: string, @Body() dto: ClarificationDto, @CurrentPrincipal() p: Principal) {
    return this.listings.clarify(userOf(p), id, dto.body);
  }

  /** FR-LST-08: cancel where allowed; an auction with bids only by an operator (U3-08). */
  @SignedIn()
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.listings.cancel(userOf(p), id);
  }

  /** The listing page: district only, clarifications, auction state with the server's time. */
  @Public()
  @Get(':id')
  view(@Id('id') id: string, @CurrentPrincipal() p: Principal | undefined) {
    return this.listings.view(id, p);
  }
}

@Controller('me')
export class MyListingsController {
  constructor(private readonly listings: ListingService) {}

  @Verified()
  @Get('listings')
  mine(@Query() q: MyListingsQuery, @CurrentPrincipal() p: Principal) {
    return this.listings.mine(userOf(p), q.status, q.cursor);
  }
}

/** Listing photos (section 6.2): served by the backend, the only one with the volume, as JPEG with nosniff. */
@Controller('listing-photos')
export class ListingPhotosController {
  constructor(private readonly listings: ListingService) {}

  @Public()
  @Get(':key')
  async photo(@Param('key') key: string, @Query() q: PhotoQuery, @Res() res: Response): Promise<void> {
    if (!STORAGE_KEY.test(key)) throw new Problem('not-found'); // a random hex name, never a path
    const path = await this.listings.photoFile(key, q.size === 'thumb' ? 'thumb' : 'full');
    const bytes = await fs.readFile(path).catch(() => {
      throw new Problem('not-found');
    });
    res
      .status(200)
      .set({
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=86400', // a key names one image forever
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      .send(bytes);
  }
}
