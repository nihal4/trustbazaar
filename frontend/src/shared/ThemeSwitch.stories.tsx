// The first story (U11-01), to show how a component is added to the catalogue: a default export that names the group and the component, and one named export for each state worth seeing.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeSwitch } from './ThemeSwitch';

const meta = { title: 'Shell/ThemeSwitch', component: ThemeSwitch, tags: ['autodocs'] } satisfies Meta<typeof ThemeSwitch>;
export default meta;

/** Press it: the theme of the whole page changes, and the choice is kept in this browser. */
export const Default: StoryObj<typeof meta> = {};
