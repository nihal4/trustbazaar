// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Counterfoil } from './Counterfoil';

// The money-order world's signature (docs/design/10_visual_v2.md, section 6; U10-11).
describe('the counterfoil', () => {
  afterEach(cleanup);
  const stages = [
    { key: 'in', label: 'Paid in', state: 'done' as const },
    { key: 'held', label: 'Held', state: 'current' as const },
    { key: 'out', label: 'Paid out', state: 'next' as const },
  ];
  const stateWords = { done: '(done)', current: '(now)', next: '(to come)' };

  it('NFR-USE-07 shows where the money is, in words as well as marks, with the current stage marked', () => {
    render(<Counterfoil stub={<strong>Order 4F2A</strong>} amount="৳25,000" amountWords="Twenty-five thousand taka" title="Your money" stages={stages} stateWords={stateWords} />);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Paid in(done)', 'Held(now)', 'Paid out(to come)']);
    expect(within(list).getByText('Held').closest('li')?.getAttribute('aria-current')).toBe('step');
    expect(screen.getAllByText('৳25,000')).toHaveLength(2);   // on the stub and on the form, as on a money order
    expect(screen.getByText('Twenty-five thousand taka')).toBeTruthy();
    expect(screen.queryByText(/postmark/i)).toBeNull();
  });

  it('NFR-USE-07 carries the postmark with its date once the money is paid out, and holds the page\'s action', () => {
    render(<Counterfoil stub="Order 4F2A" title="Paid to the seller" postmark="24 Nov 2026"><button type="button">Rate the seller</button></Counterfoil>);
    expect(screen.getByText('24 Nov 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rate the seller' })).toBeTruthy();
  });
});
