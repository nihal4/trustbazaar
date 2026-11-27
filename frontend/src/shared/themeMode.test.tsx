// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from './language/Language';
import { ThemeSwitch } from './ThemeSwitch';
import { currentTheme, setTheme } from './themeMode';

// NFR-USE-06 (U10-28): the colour theme is a choice of the person: dark (the app's look) or light, set on <html data-theme>, kept in this browser, named in words by its switch.
beforeEach(() => { localStorage.clear(); document.documentElement.setAttribute('data-theme', 'dark'); });
afterEach(cleanup);

describe('the colour theme', () => {
  it('NFR-USE-06 setting the theme changes the page and is kept for the next visit', () => {
    expect(currentTheme()).toBe('dark');
    setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('tb-theme')).toBe('light');
    expect(currentTheme()).toBe('light');
  });

  it('NFR-USE-06 the switch names what it does, in both languages, and changes the theme each time it is pressed', () => {
    const { unmount } = render(<LanguageProvider initial="en"><ThemeSwitch /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    unmount();
    render(<LanguageProvider initial="bn"><ThemeSwitch /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'হালকা মোডে যান' })).toBeTruthy();
  });

  it('NFR-USE-06 the script that sets the theme before the first paint reads only the saved choice and falls back to dark', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(`${__dirname}/../../public/theme-init.js`, 'utf8');
    const run = () => new Function(code)();
    document.documentElement.removeAttribute('data-theme');
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
    localStorage.setItem('tb-theme', 'light');
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
    localStorage.setItem('tb-theme', 'neon');
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
