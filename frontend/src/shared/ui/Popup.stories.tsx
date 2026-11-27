import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Popup, PopupActions } from './Popup';

const meta = { title: 'Primitives/Popup', component: Popup, tags: ['autodocs'] } satisfies Meta<typeof Popup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { id: 'demo', title: 'Start the handover', closeLabel: 'Close', onClose: () => {}, children: null },
  render: (args) => (
    <Popup {...args}>
      <p>Take a photo of the item, then enter the code the buyer shows you.</p>
      <PopupActions>
        <Button variant="primary">Take photo</Button>
        <Button>Not now</Button>
      </PopupActions>
    </Popup>
  ),
};

export const Confirmation: Story = {
  args: { id: 'confirm', title: 'Cancel this order?', closeLabel: 'Keep it', onClose: () => {}, children: null },
  render: () => (
    <ConfirmDialog id="confirm" title="Cancel this order?" confirmLabel="Cancel the order" cancelLabel="Keep it" onConfirm={() => {}} onCancel={() => {}}>
      <p>You will not be charged. The seller is told.</p>
    </ConfirmDialog>
  ),
};
