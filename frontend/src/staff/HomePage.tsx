// /staff: an operator starts at the queues, an administrator at the approvals.
import { Navigate, useOutletContext } from 'react-router-dom';
import type { StaffMe } from './model';

export function Component() {
  const me = useOutletContext<StaffMe>();
  return <Navigate to={me.role === 'operator' ? '/staff/queues/disputes' : '/staff/approvals'} replace />;
}
