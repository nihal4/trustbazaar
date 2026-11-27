import type { Meta, StoryObj } from '@storybook/react-vite';
import { Table, type TableColumn } from './Table';

interface Row {
  id: string;
  item: string;
  status: string;
  total: string;
}
const columns: TableColumn<Row>[] = [
  { key: 'item', header: 'Item', cell: (r) => r.item },
  { key: 'status', header: 'Status', cell: (r) => r.status },
  { key: 'total', header: 'Total', cell: (r) => r.total, align: 'end' },
];
const rows: Row[] = [
  { id: '1', item: 'OnePlus Nord CE 3, 128 GB', status: 'In escrow', total: '৳ 42,000' },
  { id: '2', item: 'Sony WH-1000XM4 headphones', status: 'Paid out', total: '৳ 18,500' },
];
const meta = {
  title: 'Primitives/Table',
  component: Table<Row>,
  tags: ['autodocs'],
  args: { columns, rows, rowKey: (r: Row) => r.id, caption: 'Your orders' },
} satisfies Meta<typeof Table<Row>>;
export default meta;

/** Under 560 px each row becomes a block and each cell shows its column name: resize the window to see it. */
export const Default: StoryObj<typeof meta> = {};
