// The app's popup (U10-23): the primitive (ui/Popup) plus the one thing that is the app's own: a popup never stands under another, so while the step-up code is asked every other popup
// is out of sight (and keeps what was typed in it).
import { Popup as Sheet, PopupActions, type PopupProps } from './ui/Popup';
import { usePendingStepUp } from './stepUp';

export function Popup({ isStepUp = false, ...props }: Omit<PopupProps, 'hidden'> & { isStepUp?: boolean }) {
  const stepping = usePendingStepUp() !== null && !isStepUp;
  return <Sheet {...props} hidden={stepping} />;
}

export { PopupActions };
