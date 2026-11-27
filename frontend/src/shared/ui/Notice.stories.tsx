import type { Meta, StoryObj } from '@storybook/react-vite';
import { Notice } from './Notice';

const meta = {
  title: 'Primitives/Notice',
  component: Notice,
  tags: ['autodocs'],
  args: { children: 'Your payout goes out two days after the buyer confirms.' },
} satisfies Meta<typeof Notice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};
export const Warning: Story = { args: { tone: 'warning', title: 'Check the time', children: 'The handover code expires in 10 minutes.' } };
export const Error: Story = { args: { tone: 'error', title: 'Photo too large', children: 'Choose one under 8 MB.' } };
