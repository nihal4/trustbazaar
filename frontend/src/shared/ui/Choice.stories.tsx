import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox, Radio } from './Choice';

const meta = { title: 'Primitives/Choice', component: Radio, tags: ['autodocs'], args: { label: 'bKash wallet' } } satisfies Meta<typeof Radio>;
export default meta;

export const Radios: StoryObj<typeof meta> = {
  render: () => (
    <div role="radiogroup" aria-label="Pay with">
      <Radio name="way" label="bKash wallet" hint="Pay from your phone" defaultChecked />
      <Radio name="way" label="Nagad" />
      <Radio name="way" label="Card" disabled />
    </div>
  ),
};
export const Checkboxes: StoryObj<typeof meta> = {
  render: () => (
    <div>
      <Checkbox label="Remember me" defaultChecked />
      <Checkbox label="Send me the receipt" hint="By e-mail, in Bangla or English" />
    </div>
  ),
};
