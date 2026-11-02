// The live connection (K-07; docs/design/09_integration.pdf section 2, Unit 1 section 4.1, Unit 3 section 3.3,
// Unit 6 section 3.2, Unit 8 section 5; SEC-SES-07, IF-COM-01, IF-COM-02, NFR-SCL-01). One Socket.IO connection per
// browser tab at /socket.io, authenticated when it opens by Unit 1's session check. The server puts it in the rooms
// sid:{session} and user:{user}; the client may join and leave auction:{listing} rooms, which carry public data only.
// Rooms span backend instances through the Redis adapter. Units send with LivePort; Unit 1 provides the check.

/** Unit 1's check of a handshake: the user's live session, 'expired' for a token to refresh first, or null. */
export interface LiveAuthenticator {
  authenticate(cookieHeader: string | undefined): Promise<{ userId: string; sessionId: string } | 'expired' | null>;
  /** Of these sessions, the ones still live (the gateway re-checks its open connections). */
  liveSessions(sessionIds: string[]): Promise<Set<string>>;
}
export const LIVE_AUTHENTICATOR = Symbol('LIVE_AUTHENTICATOR');

/** What units use to send. Messages go out after the caller's commit: send only what is already stored. */
export interface LivePort {
  toUser(userId: string, event: string, payload: Record<string, unknown>): void;
  toRoom(room: `auction:${string}`, event: string, payload: Record<string, unknown>): void;
  /** SEC-SES-07: closes every connection of an ended session, on every instance. */
  endSession(sessionId: string): void;
  /**
   * Whether the user has a live connection on any instance (Unit 6 section 7.4: a chat e-mail only when they are
   * not connected; Decisions log, U6-02). False when it cannot be told within a second.
   */
  isConnected(userId: string): Promise<boolean>;
}
export const LIVE = Symbol('LIVE');

/** The handshake errors the client acts on (I-51 d): refresh then reconnect, or sign in. */
export const LIVE_ERRORS = { expired: 'token-expired', unauthenticated: 'session-ended', origin: 'origin-not-allowed' } as const;

export const AUCTION_ROOM = /^auction:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RECHECK_MS = 30_000;
/** At most this many auction rooms per connection, so one socket cannot subscribe to everything. */
export const MAX_ROOMS = 20;
