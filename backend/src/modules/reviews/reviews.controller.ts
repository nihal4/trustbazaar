import { Controller, Get } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

// TODO(FR-65–FR-68): Post-transaction ratings and trust badges
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('health')
  health() {
    return { module: 'reviews', status: 'scaffolded', requirements: 'FR-65–FR-68' };
  }
}
