# Security Policy

## Project Status

TrustBazaar is an academic capstone project under active development (Daffodil International University, Department of Software Engineering). It is not yet a deployed production system — all payment and courier integrations run in sandbox/test mode only, per the constraints documented in `docs/srs.tex`. No real financial transactions are processed anywhere in this repository.

## Supported Versions

Only the `main` branch is actively maintained. There are no tagged releases yet; security fixes are applied directly to `main`.

| Branch | Supported |
| ------ | --------- |
| `main` | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project:

1. **Do not open a public issue.** Use [GitHub's private vulnerability reporting](https://github.com/nihal4/trustbazaar/security/advisories/new) for this repository, if enabled, or email **sm.nihal4@gmail.com** directly with details.
2. Include what you found, how to reproduce it, and its potential impact if you can.
3. You can expect an initial response within **5 business days** — this is a student team, not a staffed security desk, so response times may vary around exam periods or project deadlines.
4. If confirmed, we'll work on a fix and credit you in the fix's commit/PR unless you'd prefer to stay anonymous.
5. Please allow us reasonable time to address the issue before any public disclosure.

## Scope

Given the project's current stage, the most relevant areas for security review are:
- Authentication and JWT handling (`backend/src/modules/auth`)
- KYC document handling and access control (`backend/src/modules/kyc`)
- Escrow/payment settlement logic (`backend/src/modules/payments`)
- Auction bid concurrency (`backend/src/modules/auctions`)

Since all payment provider integrations are sandbox-only, reports involving real financial impact are out of scope by definition — but logic errors that *would* cause real harm in a production deployment (e.g. a way to bypass escrow, double-spend a bid, or forge KYC approval) are very much in scope and appreciated.