// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar, Button, Checkbox, Count, Field, IconButton, initials, Input, Notice, Radio, Tag, TextField } from './index';

afterEach(cleanup);

const css = (name: string) => readFileSync(join(__dirname, name), 'utf8');

describe('Button (U11-04)', () => {
  it('NFR-USE-06 a button is at least 44 px high, and the large size is 56 px', () => {
    expect(css('button.module.css')).toMatch(/\.button\s*\{[^}]*min-height:\s*44px/);
    expect(css('button.module.css')).toMatch(/\.lg\s*\{[^}]*min-height:\s*56px/);
  });

  it('NFR-USE-06 a button that does not say it submits does not submit a form', () => {
    const submit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button>Plain</Button>
        <Button type="submit">Send</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('NFR-USE-06 a running action is disabled and announced as busy', () => {
    const click = vi.fn();
    render(
      <Button loading onClick={click}>
        Pay
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Pay' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });

  it('NFR-USE-06 a link that looks like a button stays a link', () => {
    render(
      <Button as="a" href="/orders" variant="primary">
        Orders
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Orders' }).getAttribute('href')).toBe('/orders');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('NFR-USE-06 an icon button is named by its label', () => {
    render(<IconButton label="Switch theme">☼</IconButton>);
    expect(screen.getByRole('button', { name: 'Switch theme' })).toBeTruthy();
  });
});

describe('Field (U11-04)', () => {
  it('NFR-USE-06 a field has a visible label, and its hint and error describe the control', () => {
    render(<TextField label="Phone number" hint="Eleven digits" error="Too short" />);
    const input = screen.getByLabelText('Phone number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described).toHaveLength(2);
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(['Eleven digits', 'Too short']);
  });

  it('NFR-USE-06 a field with no error is not marked invalid and describes nothing it does not have', () => {
    render(<TextField label="Name" />);
    const input = screen.getByLabelText('Name');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('NFR-USE-06 two fields never share an id', () => {
    render(
      <>
        <TextField label="One" />
        <TextField label="Two" />
      </>,
    );
    expect(screen.getByLabelText('One').id).not.toBe(screen.getByLabelText('Two').id);
  });

  it('NFR-USE-06 any control can sit in a field', () => {
    render(<Field label="Code">{(control) => <Input {...control} defaultValue="1234" />}</Field>);
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('1234');
  });

  it('NFR-USE-06 a control is 48 px high and square', () => {
    const rule = /\.control\s*\{[^}]*\}/.exec(css('field.module.css'))?.[0] ?? '';
    expect(rule).toMatch(/min-height:\s*48px/);
    expect(rule).toMatch(/border-radius:\s*0/);
  });
});

describe('Choice (U11-04)', () => {
  it('NFR-USE-06 a radio and a checkbox are chosen through their label', () => {
    render(
      <>
        <Radio name="way" label="bKash wallet" />
        <Checkbox label="Remember me" hint="On this phone only" />
      </>,
    );
    fireEvent.click(screen.getByText('bKash wallet'));
    expect((screen.getByRole('radio', { name: 'bKash wallet' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText('Remember me'));
    const box = screen.getByRole('checkbox', { name: /Remember me/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('On this phone only');
  });
});

describe('Notice, Tag, Count, Avatar (U11-04)', () => {
  it('NFR-USE-06 an error notice is announced at once, the others politely', () => {
    render(
      <>
        <Notice tone="error">Photo too large</Notice>
        <Notice>Paid after the handover</Notice>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Photo too large');
    expect(screen.getByRole('status').textContent).toBe('Paid after the handover');
  });

  it('NFR-USE-06 a tag says its state in words', () => {
    render(<Tag tone="ok">Verified</Tag>);
    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('NFR-USE-05 a count never grows wider than a cell, and zero shows nothing', () => {
    const { rerender, container } = render(<Count value={3} />);
    expect(container.textContent).toBe('3');
    rerender(<Count value={250} />);
    expect(container.textContent).toBe('99+');
    rerender(<Count value={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('NFR-USE-04 initials come from the first letters of the first two words, in any script', () => {
    expect(initials('Test Seller')).toBe('TS');
    expect(initials('  rahim  ')).toBe('R');
    expect(initials('রহিম উদ্দিন আহমেদ')).toBe('রউ');
    expect(initials('')).toBe('?');
    render(<Avatar name="Test Seller" />);
    expect(screen.getByText('TS')).toBeTruthy();
  });
});
