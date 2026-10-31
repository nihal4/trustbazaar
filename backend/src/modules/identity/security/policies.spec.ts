import { STAFF_ROLES } from '../../../kernel/http/policies';
import { STAFF_ROLE } from '../db/enums';
import { PIPELINE } from './guards';

describe('policies', () => {
  it('DC-7 the kernel\'s staff roles are exactly the database enum identity.staff_role', () => {
    expect([...STAFF_ROLES]).toEqual([...STAFF_ROLE]);
  });

  it('DC-7 the pipeline runs in the order of Unit 1 section 4.1', () => {
    expect(PIPELINE.map((g) => g.name)).toEqual(['RateLimitGuard', 'AuthGuard', 'CsrfGuard', 'PolicyGuard', 'StepUpGuard']);
  });
});
