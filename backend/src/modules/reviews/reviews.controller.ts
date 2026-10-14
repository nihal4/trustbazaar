import { Controller, Get } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

// TODO(FR-REV-01–FR-REV-07): Post-transaction ratings and trust badges
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('health')
  health() {
    return { module: 'reviews', status: 'scaffolded', requirements: 'FR-REV-01–FR-REV-07' };
  }
}
