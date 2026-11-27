import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field, Input, Select, TextField, Textarea } from './Field';

const meta = { title: 'Primitives/Field', component: TextField, tags: ['autodocs'], args: { label: 'Phone number' } } satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'Eleven digits, starting with 01' } };
export const WithError: Story = { args: { defaultValue: '0171', error: 'Enter the whole number.' } };
export const Disabled: Story = { args: { disabled: true, defaultValue: '01712345678' } };

/** The control inside a field can be any of the three. */
export const Controls: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20, maxWidth: 420 }}>
      <Field label="Name">{(c) => <Input {...c} />}</Field>
      <Field label="District">
        {(c) => (
          <Select {...c}>
            <option>Dhaka</option>
            <option>Chattogram</option>
          </Select>
        )}
      </Field>
      <Field label="Message" hint="What you want the seller to know">
        {(c) => <Textarea {...c} />}
      </Field>
    </div>
  ),
};
