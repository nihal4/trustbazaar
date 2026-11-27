import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';

const meta = { title: 'Primitives/Avatar', component: Avatar, tags: ['autodocs'], args: { name: 'Test Seller' } } satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = {};
export const Bangla: Story = { args: { name: 'রহিম উদ্দিন' } };
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'end' }}>
      <Avatar name="Test Seller" size="sm" />
      <Avatar name="Test Seller" />
      <Avatar name="Test Seller" size="lg" />
    </div>
  ),
};
