# TrustBazaar

A verified peer-to-peer auction and marketplace platform for used goods and game accounts, built for individual-to-individual resale in Bangladesh: identity-verified users, escrow-protected payment (bKash, Nagad, card), a server-authoritative time-boxed auction engine, a safe meetup or system-quoted courier for delivery, and a game-account escrow with sealed credentials and a protection period.

This repository is the implementation scaffold for the Software Requirements Specification (SRS v2.0), Project Proposal and Supplementary Market Analysis in `docs/`. It is a capstone project at Daffodil International University (DIU), Department of Software Engineering.

## Team.

| Name | ID |
|---|---|
| S. M. Nihal Ahmed | 232-35-002 |
| Afrim Hossen Khan | 232-35-076 |
| Sabikun Nahar Sinthia | 232-35-475 |

## Repository Structure

```
trustbazaar/
├── docs/                    # SRS, Proposal, Supplementary Market Analysis (source + PDF)
├── backend/                 # NestJS (TypeScript) API — auth, listings, auctions,
│                             #   orders, payments/escrow, delivery, chat, disputes
│   └── src/
│       ├── entities/        # TypeORM entities (data model to be finalised in the SDD)
│       ├── modules/         # One module per feature area (see below)
│       └── realtime/        # WebSocket gateway for live bids, chat, notifications
├── frontend/                # React + Vite (TypeScript) web client
├── .github/workflows/       # CI pipeline (runs on every push to main, per SEC-SDL-02)
├── docker-compose.yml       # backend + frontend + postgres + redis, as separate containers (NFR-MNT-01)
└── .env.example             # required environment variables (copy to .env)
```

### Backend modules → SRS v2.0 requirement areas

Requirement identifiers are area-based since SRS v2.0 (Appendix D of the SRS maps every v1.1 number such as `FR-23` to its new identifier).

| Module | SRS area | Requirements |
|---|---|---|
| `auth`, `users` | Account registration and authentication | FR-ACC-01–FR-ACC-11, SEC-AUTH, SEC-SES |
| `kyc` | Identity verification | FR-KYC-01–FR-KYC-12 |
| `listings` | Listing creation; search and discovery | FR-LST-01–FR-LST-13, FR-SRC-01–FR-SRC-06 |
| `auctions` | Auction engine | FR-AUC-01–FR-AUC-18 |
| `orders` | Fixed-price purchase | FR-FIX-01–FR-FIX-05 |
| `payments` | Payment, escrow, refunds and payouts | FR-PAY-01–FR-PAY-21 |
| `delivery` | Meetup handover and courier delivery | FR-DLV-01–FR-DLV-14 |
| *planned:* `game-accounts` | Game-account escrow | FR-GAM-01–FR-GAM-20, SEC-GAM |
| `chat` | Real-time chat | FR-CHT-01–FR-CHT-10 |
| `reviews` | Ratings, reviews and trust signals | FR-REV-01–FR-REV-07 |
| `disputes` | Dispute resolution | FR-DSP-01–FR-DSP-12 |
| `notifications` | Notifications | FR-NTF-01–FR-NTF-08 |
| `payments` (monetization) | Monetization | FR-MON-01–FR-MON-10 |
| *planned:* trust & safety, staff (operator/administrator) | Trust and safety; operator and administrator functions | FR-TNS-01–FR-TNS-09, FR-OPS-01–FR-OPS-09 |
| *planned:* privacy | Privacy and data-subject rights | FR-PRV-01–FR-PRV-06 |
| cross-cutting (guards, interceptors, config) | Security and quality requirements | SEC-*, NFR-* |

Each module currently contains a minimal, working NestJS module/controller/service stub with `TODO` markers pointing at the specific requirement it needs to implement — this is a scaffold to build on, not a finished system.

## Getting Started

### Prerequisites
- Docker and Docker Compose
- Node.js 20+ and npm (only needed if you want to run backend/frontend outside Docker)

### Setup
```bash
# 1. Copy environment variables and fill in sandbox credentials
cp .env.example .env

# 2. Start everything (Postgres, Redis, backend, frontend)
docker compose up --build

# Backend API:  http://localhost:3000
# Frontend:     http://localhost:5173
```

### Running the backend alone (local dev, without Docker)
```bash
cd backend
npm install
npm run start:dev
```

### Running tests
```bash
cd backend
npm test
```
The concurrency-sensitive test suite (`test/concurrency/`) covers the properties called out as the project's evaluation criteria: simultaneous bidding, simultaneous stock decrement, duplicate payment-webhook delivery, and settlement fee-split correctness (NFR-MNT-02; acceptance criteria in SRS Appendix A).

## Environment Variables

See `.env.example` for the full list. At minimum you will need sandbox/test-mode credentials for:
- **bKash** and/or **Nagad** merchant sandbox
- **Stripe** test mode (card payments)
- A courier sandbox API key, or leave unset to fall back to the documented mock courier service

No real financial transactions are processed anywhere in this repository — see `docs/srs.tex`, Section 2.5 (Design and Implementation Constraints, C-2 and C-3).

## Documentation

See [`docs/README.md`](docs/README.md) for build instructions.

- `docs/srs.tex` / `docs/srs.pdf` — Software Requirements Specification v2.0 (IEEE 830-1998 structure): functional, security and quality requirements, configurable parameters, acceptance criteria and traceability
- `docs/proposal.tex` / `docs/proposal.pdf` — Project Proposal (revised), including the 12-week timeline
- `docs/supplementary/` — Supplementary Market Analysis of Bikroy.com and its alternatives, cited by the proposal and the SRS
- The System Design Document (architecture, data model, sequence diagrams, API contracts) is the next deliverable. It will be designed one unit at a time under `docs/design/`, then combined into the full system architecture.

## License

MIT — see `LICENSE`.
