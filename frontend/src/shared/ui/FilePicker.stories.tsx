import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilePicker } from './FilePicker';

const meta = { title: 'Primitives/FilePicker', component: FilePicker, tags: ['autodocs'] } satisfies Meta<typeof FilePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

const base = { id: 'files', action: 'Choose files', accept: 'image/jpeg,image/png,image/webp', onFiles: () => undefined };

/** Nothing chosen yet: the action on the left, what is chosen on the right. */
export const Empty: Story = { args: { ...base, status: 'No file chosen', multiple: true } };

/** Files chosen. */
export const Chosen: Story = { args: { ...base, status: 'Files chosen: 3', multiple: true } };

/** A file that is used at once (a photo uploaded on choosing): the cell has no status. */
export const UsedAtOnce: Story = { args: { ...base, action: 'Add photos (3 more allowed)' } };

/** While something is being sent. */
export const Disabled: Story = { args: { ...base, status: 'No file chosen', disabled: true } };
