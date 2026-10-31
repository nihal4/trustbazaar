import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { CsrfGuard } from './csrf.guard';
import { PolicyGuard } from './policy.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { StepUpGuard } from './step-up.guard';

// The security pipeline, in the order of Unit 1 section 4.1. Nest runs global guards in the order they
// are registered, so this list is the order every request takes.
export const PIPELINE = [RateLimitGuard, AuthGuard, CsrfGuard, PolicyGuard, StepUpGuard];

export const pipelineGuards = PIPELINE.map((useClass) => ({ provide: APP_GUARD, useClass }));
