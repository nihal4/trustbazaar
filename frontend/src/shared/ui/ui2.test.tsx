// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Calendar, Card, ConfirmDialog, FactList, Panel, Popup, Section, Stepper, Tab, Table, Tabs } from './index';

afterEach(cleanup);
const css = (name: string) => readFileSync(join(__dirname, name), 'utf8');

describe('Panel, Section, Card (U11-05)', () => {
  it('NFR-USE-06 a titled panel is a region named by its heading', () => {
    render(
      <Panel title="Money for this order" variant="emphasis">
        ৳ 42,000
      </Panel>,
    );
    expect(screen.getByRole('region', { name: 'Money for this order' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Money for this order');
  });

  it('NFR-USE-06 a section has its heading level and an action beside it', () => {
    render(
      <Section title="Deadlines" headingLevel={3} action={<a href="/help">Help</a>}>
        body
      </Section>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Deadlines' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Help' })).toBeTruthy();
  });

  it('NFR-USE-06 a card that is a link stays a link, with its picture above', () => {
    render(
      <Card as="a" href="/listings/1" media={<img alt="Phone" src="x.jpg" />}>
        OnePlus Nord
      </Card>,
    );
    const link = screen.getByRole('link', { name: /OnePlus Nord/ });
    expect(link.getAttribute('href')).toBe('/listings/1');
    expect(within(link).getByRole('img', { name: 'Phone' })).toBeTruthy();
  });
});

describe('FactList (U11-05)', () => {
  it('NFR-USE-05 facts are a description list that uses fewer columns on a phone', () => {
    const { container } = render(
      <FactList
        items={[
          { label: 'Quantity', value: '1' },
          { label: 'Total', value: '৳ 42,000' },
        ]}
      />,
    );
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(container.querySelector('dd')?.textContent).toBe('1');
    expect(css('factList.module.css')).toMatch(/@media \(max-width: 560px\)[^}]*\.cols4/);
  });
});

describe('Stepper (U11-05)', () => {
  const steps = [
    { key: 'a', label: 'Payment complete', state: 'done' as const },
    { key: 'b', label: 'Money on hold', state: 'current' as const, note: '28 Nov' },
    { key: 'c', label: 'Seller paid', state: 'next' as const },
  ];

  it('NFR-USE-07 the steps are an ordered list with the current one marked and each state in words', () => {
    render(<Stepper steps={steps} label="Order progress" stateWords={{ done: 'done', current: 'current step', next: 'still to come' }} />);
    const items = within(screen.getByRole('list', { name: 'Order progress' })).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(items[1].textContent).toContain('current step');
    expect(items[2].textContent).toContain('still to come');
  });

  it('NFR-USE-05 the steps stack in one column on a phone', () => {
    expect(css('stepper.module.css')).toMatch(/@media \(max-width: 560px\)\s*\{\s*\.steps\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  });
});

describe('Table (U11-05)', () => {
  it('NFR-USE-05 every cell carries its column name, so a row can stack on a phone', () => {
    render(
      <Table
        caption="Your orders"
        columns={[
          { key: 'item', header: 'Item', cell: (r: { item: string; total: string }) => r.item },
          { key: 'total', header: 'Total', cell: (r) => r.total, align: 'end' },
        ]}
        rows={[{ item: 'Phone', total: '৳ 42,000' }]}
        rowKey={(r) => r.item}
      />,
    );
    expect(screen.getByRole('table', { name: 'Your orders' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '৳ 42,000' }).getAttribute('data-label')).toBe('Total');
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeTruthy();
    expect(css('table.module.css')).toMatch(/@media \(max-width: 560px\)/);
  });
});

describe('Tabs (U11-05)', () => {
  it('NFR-USE-06 tabs are links in a named navigation, the current one marked', () => {
    render(
      <Tabs label="Account">
        <Tab href="/account" aria-current="page">
          Profile
        </Tab>
        <Tab href="/account/security">Security</Tab>
      </Tabs>,
    );
    const nav = screen.getByRole('navigation', { name: 'Account' });
    expect(within(nav).getByRole('link', { name: 'Profile' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Security' }).hasAttribute('aria-current')).toBe(false);
  });
});

describe('Popup and ConfirmDialog (U11-05)', () => {
  it('NFR-USE-06 a popup is a dialog named by its title that closes with Escape and the close button', () => {
    const close = vi.fn();
    render(
      <Popup id="p" title="Report this conversation" closeLabel="Close" onClose={close}>
        <p>body</p>
      </Popup>,
    );
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.getAttribute('aria-labelledby')).toBe('p-title');
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('NFR-USE-06 a busy popup does not close, and a hidden one is out of sight but still there', () => {
    const close = vi.fn();
    render(
      <Popup id="p" title="Paying" closeLabel="Close" busy hidden onClose={close}>
        <input defaultValue="typed" />
      </Popup>,
    );
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(dialog.style.display).toBe('none');
    expect((dialog.querySelector('input') as HTMLInputElement).value).toBe('typed');
  });

  it('IF-UI-10 a confirmation names its action, starts on the safe choice and cancels with the other button', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(
      <ConfirmDialog id="c" title="Cancel this order?" confirmLabel="Cancel the order" cancelLabel="Keep it" onConfirm={confirm} onCancel={cancel}>
        You will not be charged.
      </ConfirmDialog>,
    );
    expect(document.activeElement?.textContent).toBe('Keep it');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the order', hidden: true }));
    expect(confirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it', hidden: true }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('Calendar (U11-05)', () => {
  const labels = { close: 'Close', prevMonth: 'Previous month', nextMonth: 'Next month', month: 'Month', year: 'Year' };
  const calendar = (over: Partial<Parameters<typeof Calendar>[0]> = {}) => (
    <Calendar
      title="Date of birth"
      value=""
      min="1900-01-01"
      max="2026-12-31"
      startAt="1995-04-12"
      locale="en-GB"
      digits={(s) => s}
      labels={labels}
      onPick={() => {}}
      onClose={() => {}}
      {...over}
    />
  );

  it('NFR-USE-06 the calendar is a grid of days with the chosen one selected, and a day is picked with a click', () => {
    const pick = vi.fn();
    render(calendar({ value: '1995-04-12', onPick: pick }));
    const grid = screen.getByRole('grid', { hidden: true });
    expect(grid.getAttribute('aria-label')).toBe('April 1995');
    const chosen = within(grid)
      .getAllByRole('gridcell', { hidden: true })
      .filter((c) => c.getAttribute('aria-selected') === 'true');
    expect(chosen).toHaveLength(1);
    expect(chosen[0].textContent).toBe('12');
    fireEvent.click(within(grid).getByText('20'));
    expect(pick).toHaveBeenCalledWith('1995-04-20');
  });

  it('NFR-USE-06 days outside the allowed range cannot be chosen', () => {
    render(calendar({ value: '2026-12-15', min: '2026-12-10', max: '2026-12-20' }));
    const days = within(screen.getByRole('grid', { hidden: true })).getAllByRole('gridcell', { hidden: true }) as HTMLButtonElement[];
    expect(days.find((d) => d.textContent === '9')?.disabled).toBe(true);
    expect(days.find((d) => d.textContent === '21')?.disabled).toBe(true);
    expect(days.find((d) => d.textContent === '15')?.disabled).toBe(false);
  });

  it('NFR-USE-04 the digits and the names come from the language it is given', () => {
    render(calendar({ locale: 'bn-BD', digits: (s) => s.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]), value: '1995-04-12' }));
    const grid = screen.getByRole('grid', { hidden: true });
    expect(grid.getAttribute('aria-label')).toMatch(/১৯৯৫/);
    expect(within(grid).getByText('১২')).toBeTruthy();
  });
});
