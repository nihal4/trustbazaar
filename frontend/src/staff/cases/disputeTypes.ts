export type Outcome = 'release' | 'full_refund' | 'partial_refund' | 'refund_after_return';

export interface Outcomes {
  itemPrice: string;
  deliveryFee: string;
  release: Split;
  fullRefund: Split;
  partialRefund: (Split & { itemRefund: string }) | null;
}

export interface CaseFile {
  dispute: {
    id: string;
    type: string;
    status: string;
    description: string;
    openedAt: string;
    sellerDueAt: string;
    infoDueAt: string | null;
    decisionTargetAt: string | null;
    fourEyes: boolean;
  };
  parties: { buyer: { displayName: string; verified: boolean } | null; seller: { displayName: string; verified: boolean } | null };
  order: {
    id: string;
    status: string;
    listing: { title: string; itemKind?: string };
    itemPrice: string;
    deliveryFee: string;
    total: string;
    fulfilment: string | null;
    paidAt: string | null;
  };
  escrow: { state: string; amountCollected: string };
  outcomes: Outcomes;
  game: null | {
    details: Record<string, unknown> | null;
    proof: null | { screenshot: Link | null; status?: string };
    confirmations: { step: string; at: string }[];
    accessLog: { at: string; party: string; network: string | null }[];
  };
  chat: { threadId: string; path: string } | null;
  returnCheck?: {
    checks: { matched: boolean; at: string }[];
    canResolve: boolean;
    finding: { finding: string; reason: string; at: string } | null;
    findings: ('false_claim' | 'swap')[];
  };
  history: { from: string | null; to: string; actor: string; reason: string | null; at: string }[];
  statements: { party: string; text: string | null; at: string }[];
  evidence: { id: string; party: string; mime: string; size: number; at: string; link: Link | null }[];
  context: {
    disputes: unknown[];
    strikes: { party: string; reason: string; at: string }[];
    sanctions: { party: string; kind: string; reason: string; startsAt: string }[];
  };
}

export const caseKey = (id: string) => ['staff', 'dispute', id] as const;

export interface ChatView {
  closed: boolean;
  messages: {
    seq: number;
    from: string;
    kind: string;
    text: string | null;
    caption: string | null;
    image: Link | null;
    flags: string[];
    at: string;
    removed: boolean;
  }[];
}

interface Split {
  refunded: string;
  sellerPayout: string;
}
interface Link {
  url: string;
  expiresAt: string;
}
