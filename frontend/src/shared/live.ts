// The live connection (docs/design/08_frontend.pdf section 5; Unit 3 section 3.2; I-65; U8-04). One Socket.IO
// connection per tab, opened after sign-in, over WebSocket only, so several backend instances need no sticky
// sessions. The server puts it in the user's room; a screen joins an auction's room while it is open.
// Messages may be missed while disconnected, so every (re)connection tells the screens to fetch their state
// again (IF-COM-02). A connection refused because the access token expired refreshes through api.js (any
// request does, on its 401) and connects again; one refused because the session ended stays closed.
import { createContext, useContext, useEffect, useRef } from 'react';

/** The part of a Socket.IO client socket used here (a stand-in in the tests). */
export interface LiveSocket {
  readonly connected: boolean;
  on(event: string, fn: (...args: never[]) => void): unknown;
  off(event: string, fn: (...args: never[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

/** May load the client first: it is not part of the first page load (section 9, DV-53). */
export type OpenSocket = () => LiveSocket | Promise<LiveSocket>;
type Handler = (payload: Record<string, unknown>) => void;

/** The handshake errors of Unit 1 (I-51 d). */
const TOKEN_EXPIRED = 'token-expired';
const SESSION_ENDED = 'session-ended';

/** The Socket.IO client is loaded only when a signed-in page opens the connection, after the first paint. */
export const openSocket: OpenSocket = async () => {
  const { io } = await import('socket.io-client');
  return io({ path: '/socket.io', transports: ['websocket'], withCredentials: true, autoConnect: true }) as unknown as LiveSocket;
};

export class Live {
  private socket: LiveSocket | null = null;
  private readonly rooms = new Map<string, number>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly reconnectHandlers = new Set<() => void>();
  private readonly bound = new Map<string, (p: Record<string, unknown>) => void>();

  /** `renew` makes an authenticated request, so api.js refreshes the access token if it has expired. */
  constructor(
    private readonly open: OpenSocket,
    private readonly renew: () => Promise<unknown>,
  ) {}

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  private opening = 0;

  start(): void {
    if (this.socket || this.opening) return;
    const attempt = ++this.generation;
    const opened = this.open();
    if (!(opened instanceof Promise)) return this.attach(opened);
    this.opening = attempt;
    void opened.then((s) => {
      if (this.opening !== attempt) {
        s.disconnect(); // stopped while loading
        return;
      }
      this.opening = 0;
      this.attach(s);
    }, () => {
      if (this.opening === attempt) this.opening = 0; // the next sign-in tries again
    });
  }

  private generation = 0;

  private attach(s: LiveSocket): void {
    this.socket = s;
    s.on('connect', () => {
      for (const room of this.rooms.keys()) s.emit('join', { room });
      for (const fn of this.reconnectHandlers) fn();
    });
    s.on('connect_error', ((e: { message?: string }) => {
      if (this.socket !== s) return;
      if (e?.message === TOKEN_EXPIRED) {
        void this.renew().catch(() => undefined).then(() => {
          if (this.socket === s) s.connect();
        });
      } else if (e?.message === SESSION_ENDED) {
        this.stop();
      }
    }) as never);
    for (const event of this.handlers.keys()) this.bind(event);
  }

  stop(): void {
    this.opening = 0;
    const s = this.socket;
    this.socket = null;
    this.bound.clear();
    s?.disconnect();
  }

  /** Joins a room while at least one screen wants it. */
  join(room: `auction:${string}`): () => void {
    const n = this.rooms.get(room) ?? 0;
    this.rooms.set(room, n + 1);
    if (n === 0 && this.socket?.connected) this.socket.emit('join', { room });
    return () => {
      const left = (this.rooms.get(room) ?? 1) - 1;
      if (left > 0) {
        this.rooms.set(room, left);
        return;
      }
      this.rooms.delete(room);
      if (this.socket?.connected) this.socket.emit('leave', { room });
    };
  }

  on(event: string, fn: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(fn);
    this.handlers.set(event, set);
    if (this.socket) this.bind(event);
    return () => {
      set.delete(fn);
    };
  }

  /** Called on every connection, the first included: fetch whatever messages may have been missed. */
  onConnect(fn: () => void): () => void {
    this.reconnectHandlers.add(fn);
    return () => {
      this.reconnectHandlers.delete(fn);
    };
  }

  private bind(event: string): void {
    if (!this.socket || this.bound.has(event)) return;
    const relay = (p: Record<string, unknown>) => {
      for (const fn of this.handlers.get(event) ?? []) fn(p);
    };
    this.bound.set(event, relay);
    this.socket.on(event, relay as never);
  }
}

export const LiveContext = createContext<Live | null>(null);

/** The tab's connection, or null in a document without one (the staff console, the KYC page). */
export function useLive(): Live | null {
  return useContext(LiveContext);
}

/** Listens to a live event while mounted; the latest handler is always used. */
export function useLiveEvent(event: string, handler: Handler, enabled = true): void {
  const live = useLive();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!live || !enabled) return;
    return live.on(event, (p) => latest.current(p));
  }, [live, event, enabled]);
}
