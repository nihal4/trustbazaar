import type { Meta, StoryObj } from '@storybook/react-vite';
import { FactList } from './FactList';

const items = [
  { label: 'Quantity', value: '1' },
  { label: 'Item', value: '৳ 42,000.00' },
  { label: 'Delivery', value: '৳ 0.00' },
  { label: 'Total', value: '৳ 42,000.00' },
];
const meta = { title: 'Primitives/FactList', component: FactList, tags: ['autodocs'], args: { items } } satisfies Meta<typeof FactList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FourColumns: Story = {};
export const TwoColumns: Story = { args: { columns: 2 } };
export const OneColumn: Story = { args: { columns: 1 } };
