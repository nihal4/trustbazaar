import { randomBytes } from 'crypto';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Staff } from '../../../kernel/http/policies';
import { Problem } from '../../../kernel/http/problems';
import { COURIER, CourierPort } from '../adapters/courier-port';
import { MOCK_NEXT, MockCourier, MockMoveRefused, MockUnknownConsignment, type MockConsignment } from '../adapters/mock-courier';
import { MockAdvanceDto } from './delivery.dto';

// The mock courier's simulator (docs/design/04_delivery.pdf sections 3.1 and 7.10; FR-DLV-14; U4-04). COURIER_MODE=mock
// only: with any other courier these routes answer not-found. An operator moves a simulated parcel to its next status;
// the mock then sends its signed webhook to the normal handler, so the same code path is used as for a provider.
// The page shows consignments by area only, never an address.
const CONSIGNMENT = /^MOCK-[0-9A-F]{12}$/;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Controller('mock-courier')
export class MockCourierController {
  constructor(@Inject(COURIER) private readonly courier: CourierPort) {}

  private mock(): MockCourier {
    if (!(this.courier instanceof MockCourier)) throw new Problem('not-found');
    return this.courier;
  }

  @Staff('operator')
  @Post('consignments/:c/advance')
  @HttpCode(200)
  async advance(@Param('c') c: string, @Body() dto: MockAdvanceDto) {
    const mock = this.mock();
    if (!CONSIGNMENT.test(c)) throw new Problem('not-found');
    try {
      const r = await mock.advance(c, dto.status, dto.returnCharge === undefined ? undefined : BigInt(dto.returnCharge));
      return { consignment: view(r.consignment), event: r.event, webhook: r.webhook };
    } catch (err) {
      if (err instanceof MockUnknownConsignment) throw new Problem('not-found');
      if (err instanceof MockMoveRefused) throw new Problem('validation-failed', { errors: [{ field: 'status', reason: `not-from-${err.from}` }] });
      throw err;
    }
  }

  /** The simulator page: the latest simulated parcels with the moves the mock courier allows. */
  @Staff('operator')
  @Get()
  async page(@Res() res: Response) {
    const mock = this.mock();
    const nonce = randomBytes(16).toString('base64');
    const rows = (await mock.recent()).map((c) => {
      const moves = (MOCK_NEXT[c.status] ?? []).map((s) => `<button type="button" data-c="${escape(c.id)}" data-s="${escape(s)}">${escape(s.replace(/_/g, ' '))}</button>`).join(' ');
      const charge = MOCK_NEXT[c.status]?.includes('returned_to_seller')
        ? ` <label>Return charge, BDT <input id="charge-${escape(c.id)}" inputmode="numeric" size="5"></label>` : '';
      return `<tr><td><code>${escape(c.id)}</code></td><td>${escape(c.from)} → ${escape(c.to)}</td><td>${c.parcel.billedKg} kg, ${escape(c.parcel.sizeClass)}</td>
<td><strong>${escape(c.status.replace(/_/g, ' '))}</strong>${c.returnRequested ? ' (return requested)' : ''}</td><td>${moves || '—'}${charge}</td></tr>`;
    }).join('\n');
    const auto = mock.autoAdvanceSeconds > 0 ? `Parcels also move by themselves every ${mock.autoAdvanceSeconds} seconds.` : 'Parcels move only when you press a button.';
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mock courier simulator</title><style nonce="${nonce}">body{font-family:system-ui,sans-serif;margin:16px;max-width:1100px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}button{margin:2px}#msg{min-height:1.4em;color:#a00}</style></head><body>
<h1>Mock courier simulator</h1>
<p>This is the simulated courier of a TrustBazaar test system. No parcel moves and no courier is paid. ${escape(auto)}</p>
<p id="msg" role="status"></p>
<table><thead><tr><th>Consignment</th><th>From → to</th><th>Parcel</th><th>Status</th><th>Move to</th></tr></thead><tbody>
${rows || '<tr><td colspan="5">No simulated parcels yet.</td></tr>'}
</tbody></table>
<script nonce="${nonce}">
document.querySelectorAll('button[data-c]').forEach(function (b) {
  b.addEventListener('click', async function () {
    var c = b.getAttribute('data-c'), s = b.getAttribute('data-s'), body = { status: s };
    var input = document.getElementById('charge-' + c);
    if (s === 'returned_to_seller' && input && input.value.trim() !== '') body.returnCharge = String(Math.round(Number(input.value) * 100));
    var m = document.cookie.match(/(?:^|; )__Host-tb_scsrf=([^;]*)/);
    var r = await fetch('/api/v1/mock-courier/consignments/' + encodeURIComponent(c) + '/advance', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': m ? decodeURIComponent(m[1]) : '' }, body: JSON.stringify(body)
    });
    if (r.ok) location.reload(); else document.getElementById('msg').textContent = 'The move was refused (' + r.status + ').';
  });
});
</script></body></html>`;
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      })
      .send(body);
  }
}

const view = (c: MockConsignment) => ({ id: c.id, status: c.status, from: c.from, to: c.to, returnRequested: c.returnRequested, events: c.events });
