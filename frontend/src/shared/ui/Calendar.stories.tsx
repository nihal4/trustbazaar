import type { Meta, StoryObj } from '@storybook/react-vite';
import { Calendar } from './Calendar';

const labels = { close: 'Close', prevMonth: 'Previous month', nextMonth: 'Next month', month: 'Month', year: 'Year' };
const meta = {
  title: 'Primitives/Calendar',
  component: Calendar,
  tags: ['autodocs'],
  args: {
    title: 'Date of birth',
    value: '1995-04-12',
    min: '1900-01-01',
    max: '2026-12-31',
    locale: 'en-GB',
    digits: (s: string) => s,
    labels,
    onPick: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof Calendar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const English: Story = {};
export const Bangla: Story = { args: { locale: 'bn-BD', digits: (s: string) => s.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]) } };
