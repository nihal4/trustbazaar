# TrustBazaar

A verified peer-to-peer auction and marketplace platform for used goods, built for individual-to-individual resale in Bangladesh: identity-verified sellers, escrow-protected payment (bKash, Nagad, card), a server-authoritative time-boxed auction engine, and system-computed delivery (self-pickup vs. courier).

This repository is the implementation scaffold for the Software Requirements Specification (SRS) and Project Proposal in `docs/`. It is a capstone project at Daffodil International University (DIU), Department of Software Engineering.

## Team.

| Name | ID |
|---|---|
| S. M. Nihal Ahmed | 232-35-002 |
| Afrim Hossen Khan | 232-35-076 |
| Sabikun Nahar Sinthia | 232-35-475 |

## Repository Structure

```
trustbazaar/
├── docs/                    # SRS, Project Proposal (source + compiled PDF)
├── backend/                 # NestJS (TypeScript) API — auth, listings, auctions,
│                             #   orders, payments/escrow, delivery, chat, disputes
│   └── src/
│       ├── entities/        # TypeORM entities matching the SRS data model
│       ├── modules/         # One module per feature area (see below)
│       └── realtime/        # WebSocket gateway for live bids, chat, notifications
├── frontend/                # React + Vite (TypeScript) web client
├── .github/workflows/       # CI pipeline (runs on every push to main, per NFR-16)
├── docker-compose.yml       # backend + frontend + postgres + redis, as separate containers (NFR-14)
└── .env.example             # required environment variables (copy to .env)
```

### Backend modules → SRS feature areas

| Module | SRS Feature | Requirement range |
|---|---|---|
| `auth`, `users`, `kyc` | F1: Account Registration and KYC Verification | FR-1–FR-9 |
| `listings` | F2/F3: Listing Creation, Search and Discovery | FR-10–FR-22 |
| `auctions` | F4: Auction Engine | FR-23–FR-34 |
| `orders` | F5: Fixed-Price Purchase | FR-35–FR-38 |
| `payments` | F6: Payment and Escrow Settlement | FR-39–FR-49 |
| `delivery` | F7: Delivery and Fulfilment | FR-50–FR-58 |
| `chat` | F8: Real-Time Chat | FR-59–FR-64 |
| `reviews` | F9: Ratings, Reviews, and Trust Signals | FR-65–FR-68 |
| `disputes` | F10: Dispute Resolution | FR-69–FR-73 |
| `notifications` | F11: Notifications | FR-74–FR-77 |
| `payments` (monetization) | F12: Monetization Features | FR-78–FR-86 |
| cross-cutting (guards/interceptors) | F13: Trust and Safety Controls | FR-87–FR-91 |

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
The concurrency-sensitive test suite (`test/concurrency/`) covers the properties called out as the project's evaluation criteria: simultaneous bidding, simultaneous stock decrement, duplicate payment-webhook delivery, and settlement fee-split correctness (NFR-15).

## Environment Variables

See `.env.example` for the full list. At minimum you will need sandbox/test-mode credentials for:
- **bKash** and/or **Nagad** merchant sandbox
- **Stripe** test mode (card payments)
- A courier sandbox API key, or leave unset to fall back to the documented mock courier service

No real financial transactions are processed anywhere in this repository — see `docs/srs.tex`, Section 2.6 (Design and Implementation Constraints).

## Documentation

- `docs/srs.tex` — full Software Requirements Specification (IEEE 830-1998 format)
- `docs/proposal.tex` / `docs/proposal.pdf` — Project Proposal, including the team's 12-week timeline
- A System Design Document (full normalized schema, sequence diagrams, API contracts) is a planned deliverable, to be added under `docs/` as the design phase progresses.

## License

MIT — see `LICENSE`.
