# The staff console

A document of its own (`entries/staff.tsx`, `staff.html`) with the staff session and none of the member app's code. Operators handle cases; administrators also manage staff, the parameters and the reference data. Everything a staff member does that matters is audited, and the sensitive decisions need a second person (four eyes).

## Pages

| Address | Page |
|---|---|
| `/staff/signin` | password and authenticator code |
| `/staff`, `/staff/queues`, `/staff/queues/:queue` | the work queues (disputes, reports, flagged activity, KYC, listings in review, ownership proofs, payout accounts, payment discrepancies) |
| `/staff/disputes/:id`, `/staff/kyc/:id`, `/staff/listings/:id`, ... | one case (`cases/`) |
| `/staff/approvals`, `/staff/terms` | a second person's approvals; the screening terms |
| `/admin/staff`, `/admin/config`, `/admin/reference`, `/admin/audit` | staff accounts, the parameter set, the reference data, the audit log (`admin/`) |

## Where to start

- `Layout.tsx`: the sidebar and the session timer. `routes.tsx` lists the pages.
- `cases/`: one folder of screens for the cases. A dispute is `DisputePage.tsx` with `DisputeDecide`, `DisputeChat`, `DisputeReturnPanel`, `DisputeGameEvidence` and `DisputeEvidencePack`; `common.tsx` has the action form every decision uses.
- `admin/`: `ConfigPage.tsx` (the parameters), `ReferencePage.tsx` (games, areas, meetup points, fares), `StaffPage.tsx`, `AuditPage.tsx`; `forms.tsx` has the small forms they share.

## Talks to

The `Staff`, `StaffAuth`, `StaffKyc`, `Admin`, `Config`, `ChatStaff`, `DeliveryStaff`, `ListingsStaff` and `StaffPayouts` sections of [docs/api/openapi.json](../../../docs/api/openapi.json). The server decides who may do what; the console only offers what the case file says is allowed.

## Tests

`staff.test.tsx` and the screens in the screenshot tests (`staff-queue`, `staff-approvals`, `staff-terms`). Words are in `messages/{en,bn}/staff.json`.
