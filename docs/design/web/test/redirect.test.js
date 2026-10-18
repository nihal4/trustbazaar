import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProviderRedirect } from '../src/redirect.js';

const hosts = ['checkout.provider-a.test', 'pay.provider-b.test'];
const o = 'https://trustbazaar.test';
const ok = (u) => assert.ok(checkProviderRedirect(u, hosts, o), u);
const no = (u) => assert.equal(checkProviderRedirect(u, hosts, o), null, u);

test('configured providers over HTTPS, and same-origin paths, are followed', () => {
  ok('https://checkout.provider-a.test/c/pay/abc');
  ok('https://PAY.provider-b.test:443/x?y=1');
  ok('/mock-provider/pay/123');
  ok('https://trustbazaar.test/mock-provider/pay/123');
});

test('anything else is refused', () => {
  no('http://checkout.provider-a.test/c');                 // not HTTPS
  no('https://checkout.provider-a.test.evil.test/c');      // look-alike suffix
  no('https://evil.test/?u=checkout.provider-a.test');
  no('https://user:pw@checkout.provider-a.test/c');        // credentials in the URL
  no('https://checkout.provider-a.test:8443/c');           // other port
  no('javascript:alert(1)');
  no('data:text/html,hi');
  no('//evil.test/path');                                  // protocol-relative
  no('https://provider-a.test/c');                         // parent domain is not the host
  assert.equal(checkProviderRedirect('text, not a URL', hosts, o).origin, o);   // relative text stays on our own site
});
