import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { StaffRoleName } from './policies';

// Who is calling, as Unit 1's AuthGuard established it from the session (never from the token alone,
// SEC-SES-05). Units read it with @CurrentPrincipal(); object-level checks (another user's order, ...)
// compare its ids in the service (SEC-SDL-09).
export type Principal =
  | {
      type: 'user';
      userId: string;
      sessionId: string;
      accountStatus: 'active' | 'suspended';
      kycStatus: string;
      emailVerified: boolean;
    }
  | { type: 'staff'; staffId: string; sessionId: string; role: StaffRoleName };

export interface PrincipalRequest {
  principal?: Principal;
}

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal | undefined => ctx.switchToHttp().getRequest<PrincipalRequest>().principal,
);
