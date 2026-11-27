import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stepper, type StepperStep } from './Stepper';

const steps: StepperStep[] = [
  { key: 'paid', label: 'Payment complete', note: '27 Nov', state: 'done' },
  { key: 'set', label: 'Handover set', note: '28 Nov', state: 'done' },
  { key: 'handover', label: 'Handover', note: 'Today', state: 'current' },
  { key: 'confirmed', label: 'Confirmed', note: 'After the handover', state: 'next' },
];
const meta = {
  title: 'Primitives/Stepper',
  component: Stepper,
  tags: ['autodocs'],
  args: { steps, label: 'Order progress', stateWords: { done: 'done', current: 'current step', next: 'still to come' } },
} satisfies Meta<typeof Stepper>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A row when there is room; one column on a phone. */
export const Horizontal: Story = {};
export const Vertical: Story = { args: { orientation: 'vertical' } };
