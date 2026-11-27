# TrustBazaar

A verified peer-to-peer auction and marketplace platform for used goods and game accounts, built for individual-to-individual resale in Bangladesh: identity-verified users, escrow-protected payment (bKash, Nagad, card), a server-authoritative time-boxed auction engine, a safe meetup or system-quoted courier for delivery, and a game-account escrow with sealed credentials and a protection period.

This repository is the implementation scaffold for the Software Requirements Specification (SRS v2.0), Project Proposal and Supplementary Market Analysis in `docs/`. It is a capstone project at Daffodil International University (DIU), Department of Software Engineering.

## AI disclosure

This project was built with substantial help from AI. The design documents in `docs/design/`, the backend, the frontend and their tests were written with Anthropic's Claude, through Claude Code, working under the direction of the team. Every commit Claude wrote or co-wrote says so in its message with a `Co-Authored-By: Claude` line, so the history shows exactly which changes involved AI.

The team decided what to build and how, answered every design question, and reviewed and merged every pull request. Automated checks (tests, coverage, linting, security scans) run on every change. AI-written work can still contain mistakes; please report any you find.

## Team.

| Name | ID |
|---|---|
| S. M. Nihal Ahmed | 232-35-002 |
| Afrim Hossen Khan | 232-35-076 |
| Sabikun Nahar Sinthia | 232-35-475 |

## Repository Structure

```
trustbazaar/
├── ARCHITECTURE.md          # how the parts fit: start here to understand the system
├── BUILDING.md              # the builder guide: the rules every task follows
├── PROGRESS.md              # the tasks, who owns them, what is finished, and the Decisions log
├── docs/
│   ├── srs.tex, srs.pdf    # the requirements (IDs: FR-, NFR-, SEC-, IF-)
│   ├── design/              # the design, in nine units, with the SQL and its tests
│   ├── api/                 # openapi.json, generated from the backend's code
│   ├── decisions/           # short notes on why the code is the way it is
│   └── HOW-TO.md            # "how do I change X?"
├── backend/                 # NestJS (TypeScript): the kernel and seven units (see ARCHITECTURE.md)
│   ├── src/kernel/          # config, events, policies, problems, the pool; never imports a unit
│   ├── src/modules/         # identity, listings, orders, delivery, game-accounts, chat, trust
│   ├── src/migrations/      # the schema, changed only here
│   └── test/                # API, security and concurrency tests (need PostgreSQL and Redis)
├── frontend/                # React + Vite (TypeScript): the user app, the ID check and the staff console
│   ├── src/features/        # one folder per area of the app
│   ├── src/shared/ui/       # the design system (every component once, with variants)
│   └── e2e/visual/          # the screenshot tests
├── .github/workflows/       # CI: lint, format, tests, screenshots, integration, images (SEC-SDL-02)
├── docker-compose.yml       # backend, web, PostgreSQL and Redis as separate containers (NFR-MNT-01)
└── .env.example             # the environment variables (copy to .env)
```

Each folder of `frontend/src/features/` and `backend/src/modules/` has a `README.md` that says what the area is for, where to start and how it is tested.

### The backend units and the requirements they serve

Requirement identifiers are area-based (Appendix D of the SRS maps the old numbers).

| Unit | What it does | Requirement areas |
|---|---|---|
| `identity` | accounts, sign-in, sessions, KYC, staff accounts, approvals, audit | FR-ACC, FR-KYC, SEC-AUTH, SEC-SES |
| `listings` | listings, search, the auction engine, stock | FR-LST, FR-SRC, FR-AUC |
| `orders` | orders, escrow, the ledger, payments, refunds, payouts, monetization | FR-FIX, FR-PAY, FR-MON |
| `delivery` | meetup handover and courier delivery | FR-DLV |
| `game-accounts` | game-account escrow and the sealed credential handover | FR-GAM, SEC-GAM |
| `chat` | conversations, notifications | FR-CHT, FR-NTF |
| `trust` | disputes, ratings, sanctions, privacy, the parameter set, staff work queues | FR-DSP, FR-REV, FR-TNS, FR-OPS, FR-PRV |
| the kernel and cross-cutting code | guards, policies, config, events, health | SEC-*, NFR-* |

## Building it

The design is finished (`docs/design/`, Units 1 to 9) and the system is built. Before changing code, read **[`ARCHITECTURE.md`](ARCHITECTURE.md)** (how it fits), **[`BUILDING.md`](BUILDING.md)** (the rules every task follows) and **[`docs/HOW-TO.md`](docs/HOW-TO.md)** (how to do the common changes). **[`PROGRESS.md`](PROGRESS.md)** lists the tasks, who owns them and what is finished (`python3 scripts/check_progress.py --next` lists what can be started now). `CLAUDE.md` points AI assistants to the same documents.

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
cd backend && npm test          # unit tests
cd frontend && npm test         # unit tests
```
The integration suite (the whole backend over HTTP, with the concurrency tests: simultaneous bidding, simultaneous stock decrement, duplicate payment callbacks), the screenshot tests and the checks that CI runs are described in [`docs/HOW-TO.md`](docs/HOW-TO.md).

## Environment Variables

See `.env.example` for the full list. At minimum you will need sandbox/test-mode credentials for:
- **bKash** and/or **Nagad** merchant sandbox
- **Stripe** test mode (card payments)
- A courier sandbox API key, or leave unset to fall back to the documented mock courier service

No real financial transactions are processed anywhere in this repository — see `docs/srs.tex`, Section 2.5 (Design and Implementation Constraints, C-2 and C-3).

## Documentation

See [`docs/README.md`](docs/README.md) for build instructions.

- [`ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/HOW-TO.md`](docs/HOW-TO.md), [`docs/decisions/`](docs/decisions/) and [`docs/api/`](docs/api/README.md) — how the system is built, how to change it, why it is like this, and the generated API document
- `docs/srs.tex` / `docs/srs.pdf` — Software Requirements Specification v2.0 (IEEE 830-1998 structure): functional, security and quality requirements, configurable parameters, acceptance criteria and traceability
- `docs/proposal.tex` / `docs/proposal.pdf` — Project Proposal (revised), including the 12-week timeline
- `docs/supplementary/` — Supplementary Market Analysis of Bikroy.com and its alternatives, cited by the proposal and the SRS
- `docs/design/` — the System Design Document, in nine units (Unit 9 is the integration of the whole system), with tested reference files; see `docs/design/README.md`

## License

MIT — see `LICENSE`.
