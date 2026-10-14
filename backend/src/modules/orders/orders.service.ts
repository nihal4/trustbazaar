import { Injectable } from '@nestjs/common';

// TODO(FR-FIX-01–FR-FIX-05): Fixed-price purchase with concurrency-safe stock decrement
// Implementation notes live alongside the relevant requirement in
// docs/srs.tex — read that section before writing the real logic here.
@Injectable()
export class OrdersService {}
