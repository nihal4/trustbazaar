// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fakeBackend, json, renderApp, renderDocument, standInMe } from '../testing/app';

// The Daylight shell (docs/design/10_visual.md, sections 6 and 7; U10-02): the logo, the Sell button and the footer
// of the user app, and on phones the tab bar in place of the header's links.

const phoneWidth = (on: boolean) => {
  window.matchMedia = (query: string) =>
    ({
      matches: on && query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
};

const signedIn = () => fakeBackend({ 'GET /me': json(200, standInMe), 'GET /notifications/unread-count': json(200, { count: 3 }) });
const guest = () => fakeBackend({});

afterEach(() => {
  cleanup();
  phoneWidth(false);
});

describe('the shell', () => {
  it('NFR-USE-05 on a wide screen the header has the links, the Sell button and no tab bar', async () => {
    phoneWidth(false);
    renderApp('/', signedIn());
    const header = screen.getByRole('banner');
    expect(await within(header).findByRole('link', { name: 'Orders' })).toBeTruthy();
    expect(within(header).getByRole('link', { name: 'Sell an item' }).getAttribute('href')).toBe('/sell/new');
    expect(within(header).getByRole('link', { name: 'TrustBazaar home' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/help/terms');
  });

  it('NFR-USE-05 on a phone the tab bar takes the main links, and the header keeps notifications and the account', async () => {
    phoneWidth(true);
    renderApp('/', signedIn());
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(await within(tabs).findByRole('link', { name: 'Orders' })).toBeTruthy();
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Search', 'Sell', 'Messages', 'Orders']);
    const header = screen.getByRole('banner');
    expect(
      within(header)
        .getByRole('link', { name: /^Notifications/ })
        .getAttribute('href'),
    ).toBe('/notifications');
    expect(within(header).getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account');
    expect(within(header).queryByRole('link', { name: 'Sell an item' })).toBeNull();
    expect(screen.getByRole('main').className).toMatch(/withTabs/);
  });

  it('NFR-USE-05 a guest on a phone gets Home, Search and Sell, and "Sign in" in the header', async () => {
    phoneWidth(true);
    renderApp('/', guest());
    expect(await within(screen.getByRole('banner')).findByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(
      within(screen.getByRole('navigation', { name: 'Main' }))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Search', 'Sell']);
  });

  it('NFR-USE-04 the tab bar and the footer are in Bangla', async () => {
    phoneWidth(true);
    renderApp('/', guest(), 'bn');
    expect(
      within(screen.getByRole('navigation', { name: 'প্রধান' }))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['হোম', 'খুঁজুন', 'বিক্রি']);
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'শর্তাবলি' })).toBeTruthy();
  });

  it('NFR-USE-05 the KYC page has the logo and its title, but no footer, Sell button or tab bar', () => {
    phoneWidth(true);
    renderDocument('/', guest(), 'en', {
      home: { path: '/', sameDocument: false },
      titleKey: 'shell.document.kyc',
      routes: [{ index: true, element: <h1>KYC</h1> }],
    });
    expect(within(screen.getByRole('banner')).getByText('Identity verification')).toBeTruthy();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sell an item' })).toBeNull();
  });
});
