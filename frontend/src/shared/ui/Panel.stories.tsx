import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card, Panel, Section } from './Panel';

const meta = {
  title: 'Primitives/Panel, Section and Card',
  component: Panel,
  tags: ['autodocs'],
  args: { title: 'Money for this order', children: 'Held by TrustBazaar. You are paid after the handover.' },
} satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SectionRule: Story = { args: { variant: 'section' } };
export const Boxed: Story = { args: { variant: 'boxed' } };
export const Emphasis: Story = { args: { variant: 'emphasis' } };

export const Together: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 560 }}>
      <Section title="What you can do now" action={<a href="#help">Help</a>}>
        <Panel variant="boxed">One boxed panel inside a section.</Panel>
      </Section>
      <Card as="a" href="#listing" media={<div style={{ height: 120 }} />}>
        <strong>OnePlus Nord CE 3, 128 GB</strong>
        <span>৳ 42,000</span>
      </Card>
    </div>
  ),
};
