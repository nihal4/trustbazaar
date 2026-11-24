# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the **buyer**: a person in Bangladesh hunting for a used item (a phone, a camera, a laptop, a
game account) who has to pay a stranger. They reach the site mostly on mid-range Android phones over mobile data.
They know mobile financial services (bKash, Nagad) but not auctions or escrow, so both have to be explained in plain
words where they matter (SRS NFR-USE-01, NFR-USE-07). The redesign serves the buyer's job first; selling and the
internal staff console follow the buyer's lead.

Other audiences, from the SRS (section "User Classes and Characteristics"):

- **Sellers**: individuals reselling their own things (not businesses); every seller is ID-checked before listing.
- **Guests**: may browse, search and view public profiles; cannot chat, bid, buy or list.
- **Platform operators** (internal): work the KYC, ownership-proof, report, flagged-activity and dispute queues.
- **Administrators** (internal): manage operator accounts, parameters and feature switches; never see case data.

## Product Purpose

TrustBazaar is a single responsive web application for individual-to-individual resale within Bangladesh. It exists
to make paying a stranger safe: identity-checked traders, fair price discovery, protected payment, safe handover,
and safe game-account trading. Chat, ratings and notifications support that transaction; they are not separate
products. Success is a buyer who pays, receives what was described, and confirms, without having met anyone with cash.

## Positioning

**The money waits until the buyer has the item.** Every payment is held in escrow and leaves it only by the buyer's
confirmation after handover, by a timeout counted from a recorded handover, or by an operator's dispute decision.
Every person who lists, bids, buys or receives money is identity-verified, one verified account per person. Bikroy,
Facebook Marketplace and Daraz cannot claim both truthfully for person-to-person resale.

## Operating Context

- Listings are fixed-price or server-timed auctions (proxy bidding, reserve price, anti-sniping).
- Handover is either at a suggested safe public meetup point, recorded by a one-time handover code the buyer gives
  the seller after inspecting the item, or by courier at a system-quoted fare. No cash changes hands.
- Payment through bKash, Nagad or card; in this deliverable all payment and courier integrations are sandbox or test
  mode, and the interface says so (SRS C-2, C-3).
- Game accounts: ownership is proven before listing; login details are encrypted in the browser so only the buyer
  can read them (a separate document, `secure.html`); the payment is held through a protection period.
- Identity check (KYC): NID or passport photos and two selfies, taken with the camera in a separate document
  (`kyc.html`), reviewed by an operator.
- The staff console (`staff.html`) is a separate document for operators and administrators, with four-eyes approval.

## Capabilities and Constraints

- Stack fixed by the repository (SRS C-1): React 18, React Router 6, Vite, TanStack Query; Mantine 8 as the component
  kit (U10-01); NestJS backend. A change of stack needs the whole team's agreement.
- Security policy (Unit 8): Content Security Policy without inline scripts or styles (`style-src 'self'`), Trusted
  Types, no outside fonts, CDNs or other origins; fonts are self-hosted.
- Performance (NFR-PERF-07): 170 KB of gzipped JavaScript on first load; Largest Contentful Paint at most 2.5 s on
  the mobile profile. Minimum supported width 360 px, checked at 320 px.
- Accessibility (NFR-USE-06): WCAG 2.2 AA; keyboard and screen-reader use; targets of 44 px.
- Out of scope: business storefronts, cash on delivery, native apps, publisher integration, sales outside Bangladesh.
- Terminology: listing, auction, bid, escrow ("the money waits"), handover code, meetup point, dispute, identity
  check (KYC), game account, operator, administrator.

## Brand Commitments

- Name: TrustBazaar (wordmark written "trustbazaar" in lower case in the current header).
- **Bangla and English are equal**: every screen exists fully in both, with Bangla never an afterthought (fonts,
  line height, digits and plurals per language).
- Plain, calm voice; no invented claims.

## Evidence on Hand

- Real product copy in both languages: `frontend/src/messages/en/*.json` and `frontend/src/messages/bn/*.json`.
- Sample listing photos for local runs: `backend/test/e2e/photos/{phone,camera,pad}.jpg`.
- Product renders made for the U10 mockups (phone, laptop) in `frontend/src/features/search/hero-phone.webp` and
  `frontend/src/features/account/signin-laptop.webp`.
- There are no real customers, testimonials, ratings, transaction counts or press: none may be invented.

## Product Principles

1. Trust is shown, not claimed: put the mechanism (money held, identity checked, handover code) where the decision is
   made, in plain words.
2. Buyer first: every screen answers what the buyer is getting, what it costs, and what protects them.
3. Two languages, one product: a design that only works in English is not finished.
4. Light on the phone: a mid-range Android on mobile data is the reference device.
5. Honest about the sandbox: test-mode payments and couriers are labelled, never dressed up as live.

## Accessibility & Inclusion

WCAG 2.2 AA (NFR-USE-06); usable at 320 px; keyboard and screen readers; text contrast 4.5:1, control borders 3:1;
nothing conveyed by colour alone; reduced motion respected.
