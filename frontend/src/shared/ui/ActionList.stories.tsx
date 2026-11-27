import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActionCell, ActionList } from './ActionList';

const meta = { title: 'Primitives/ActionList', component: ActionList, tags: ['autodocs'] } satisfies Meta<typeof ActionList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The actions in the rail of an order: one to a line, an arrow at the end of each. */
export const InAList: Story = {
  args: { children: null },
  render: () => (
    <ActionList>
      <ActionCell variant="primary">Confirm receipt</ActionCell>
      <ActionCell>Propose a place and time</ActionCell>
      <ActionCell variant="quiet">Ask to cancel</ActionCell>
    </ActionList>
  ),
};

/** Outside a list: a ruled cell of its own, for a button that opens a popup. */
export const Alone: Story = { args: { children: null }, render: () => <ActionCell>Add an address</ActionCell> };
