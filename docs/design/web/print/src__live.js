// TrustBazaar web client - ordering of live updates (Unit 8 reference module).
// Auction messages carry the whole state and a sequence number (Unit 3): keep the newest, drop the
// rest, and fetch /state after a reconnection. Chat messages carry a per-thread sequence number
// (Unit 6): append in order, recognise our own resends by client id, and resync after a gap.

/**
 * @typedef {{seq: number, price: number, endAt: number, serverTime: number}} AuctionState
 */
export class AuctionFeed {
  constructor() { /** @type {AuctionState | null} */ this.state = null; }
  /** @param {AuctionState} s @returns {boolean} whether the view must update */
  apply(s) {
    if (this.state && s.seq <= this.state.seq) return false;
    this.state = s;
    return true;
  }
}

/**
 * @typedef {{seq: number, clientMsgId: string, senderId: string, text?: string, flags?: string[]}} ChatMessage
 */
export class ChatThread {
  constructor() {
    /** @type {ChatMessage[]} */ this.messages = [];
    /** @type {Map<string, {clientMsgId: string, text: string}>} sent, not yet confirmed */ this.pending = new Map();
    this.lastSeq = 0;
    this.needsResync = false;
  }
  /** @param {string} text @param {string} clientMsgId a random id kept for the resends of one message */
  send(text, clientMsgId) { this.pending.set(clientMsgId, { clientMsgId, text }); }

  /** a message pushed over the socket @param {ChatMessage} m */
  receive(m) {
    if (m.seq <= this.lastSeq) return;                  // already have it
    if (m.seq > this.lastSeq + 1) { this.needsResync = true; return; }   // gap: fetch ?after=lastSeq
    this.#append(m);
  }

  /** the result of GET /threads/{id}/messages?after=lastSeq @param {ChatMessage[]} list */
  resync(list) {
    for (const m of [...list].sort((a, b) => a.seq - b.seq)) {
      if (m.seq === this.lastSeq + 1) this.#append(m);
    }
    this.needsResync = false;
  }

  /** @param {ChatMessage} m */
  #append(m) {
    this.messages.push(m);
    this.lastSeq = m.seq;
    this.pending.delete(m.clientMsgId);
  }
}
