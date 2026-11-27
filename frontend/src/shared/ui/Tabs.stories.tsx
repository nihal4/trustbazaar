import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tab, Tabs } from './Tabs';

const meta = { title: 'Primitives/Tabs', component: Tabs, tags: ['autodocs'] } satisfies Meta<typeof Tabs>;
export default meta;

export const Account: StoryObj<typeof meta> = {
  args: { label: 'Account', children: null },
  render: (args) => (
    <Tabs {...args}>
      <Tab href="#profile">Profile</Tab>
      <Tab href="#security" aria-current="page">
        Security
      </Tab>
      <Tab href="#notifications">Notifications</Tab>
      <Tab href="#messages">Messages</Tab>
      <Tab href="#data">Your data</Tab>
    </Tabs>
  ),
};
