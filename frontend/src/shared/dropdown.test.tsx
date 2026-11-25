// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Dropdown } from './Dropdown';

// NFR-USE-06 (keyboard and screen-reader use): the ruled dropdown is a combobox with a listbox, operable by keyboard alone.
const OPTIONS: [string, string][] = [['new', 'New'], ['like_new', 'Like new'], ['used', 'Used'], ['for_parts', 'For parts']];
function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <><Dropdown id="d" label="Condition" value={v} onChange={setV} options={OPTIONS} any="Any" /><output data-testid="out">{v}</output></>;
}
const box = () => screen.getByRole('combobox', { name: /Condition/ });

afterEach(cleanup);

describe('dropdown', () => {
  it('NFR-USE-06 it is a labelled combobox that shows the chosen text and opens a listbox with the options', () => {
    render(<Harness initial="used" />);
    expect(box().textContent).toBe('Used');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(box());
    expect(box().getAttribute('aria-expanded')).toBe('true');
    const options = within(screen.getByRole('listbox', { name: 'Condition' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Any', 'New', 'Like new', 'Used', 'For parts']);
    expect(options.find((o) => o.getAttribute('aria-selected') === 'true')?.textContent).toBe('Used');
  });

  it('NFR-USE-06 the arrow keys move through the options and Enter chooses; Escape closes without choosing', () => {
    render(<Harness />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(box().getAttribute('aria-activedescendant')).toBe('d-option-2');   // the first ArrowDown opens the list, the next two move
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.getByTestId('out').textContent).toBe('like_new');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'End' });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('out').textContent).toBe('like_new');
  });

  it('NFR-USE-06 a letter jumps to the next option that starts with it, and Home goes to the first option', () => {
    render(<Harness />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'f' });
    expect(box().getAttribute('aria-activedescendant')).toBe('d-option-4');
    fireEvent.keyDown(box(), { key: 'Home' });
    expect(box().getAttribute('aria-activedescendant')).toBe('d-option-0');
  });

  it('NFR-USE-06 Home and End open the list at the first or last option, and letters typed together find one option', () => {
    render(<Harness />);
    fireEvent.keyDown(box(), { key: 'End' });
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe('d-option-4');
    fireEvent.keyDown(box(), { key: 'Home' });
    expect(box().getAttribute('aria-activedescendant')).toBe('d-option-0');
    fireEvent.keyDown(box(), { key: 'l' });
    fireEvent.keyDown(box(), { key: 'i' });
    fireEvent.keyDown(box(), { key: 'k' });
    expect(box().getAttribute('aria-activedescendant')).toBe('d-option-2');   // "Like new"
  });

  it('NFR-USE-06 clicking an option chooses it, the empty choice clears, and a click outside closes the list', () => {
    render(<Harness initial="new" />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('option', { name: 'Used' }));
    expect(screen.getByTestId('out').textContent).toBe('used');
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('option', { name: 'Any' }));
    expect(screen.getByTestId('out').textContent).toBe('');
    fireEvent.click(box());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
