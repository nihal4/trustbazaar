// The app's confirmation (section 8.4): the primitive (ui/ConfirmDialog), out of sight while the step-up code is asked, like every other popup (shared/Popup.tsx).
import { ConfirmDialog as Dialog, type ConfirmDialogProps } from './ui/ConfirmDialog';
import { usePendingStepUp } from './stepUp';

export type { ConfirmDialogProps };

export function ConfirmDialog(props: Omit<ConfirmDialogProps, 'hidden'>) {
  return <Dialog {...props} hidden={usePendingStepUp() !== null} />;
}
