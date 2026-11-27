import type { Meta, StoryObj } from '@storybook/react-vite';
import { Count, Tag } from './Tag';

const meta = { title: 'Primitives/Tag and count', component: Tag, tags: ['autodocs'], args: { children: 'In escrow' } } satisfies Meta<typeof Tag>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = { args: { children: 'Draft' } };
export const Hot: Story = { args: { tone: 'hot' } };
export const Ok: Story = { args: { tone: 'ok', children: 'Verified' } };
export const Error: Story = { args: { tone: 'error', children: 'Disputed' } };
export const Counts: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      <Count value={3} />
      <Count value={42} />
      <Count value={250} />
    </div>
  ),
};
