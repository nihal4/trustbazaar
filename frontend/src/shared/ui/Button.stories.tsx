import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, IconButton } from './Button';

const meta = { title: 'Primitives/Button', component: Button, tags: ['autodocs'], args: { children: 'Start the handover' } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Back' } };
export const Quiet: Story = { args: { variant: 'quiet', children: 'Report message' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Cancel this order' } };
export const Large: Story = { args: { variant: 'primary', size: 'lg' } };
export const Loading: Story = { args: { variant: 'primary', loading: true, children: 'Paying' } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true, children: 'Continue' } };
export const FullWidth: Story = { args: { variant: 'primary', block: true } };

/** Everything at once, for a look at the whole set in the current theme and language. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      <Button variant="primary">Primary</Button>
      <Button>Secondary</Button>
      <Button variant="quiet">Quiet</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="primary" size="lg">
        Large
      </Button>
      <IconButton label="Switch theme">☼</IconButton>
    </div>
  ),
};
