import Redis from 'ioredis';
import { DevMailbox } from './modules/chat/adapters/dev-mailbox';

// The development mailbox from the command line (U6-05; Decisions log): the simulated e-mails and SMS of log mode,
// such as registration codes, without a staff account and without exposing anything on the network:
//   docker compose exec backend node dist/dev-mailbox.js                 the last 20 messages
//   docker compose exec backend node dist/dev-mailbox.js --to 01712345678 messages to one number or address
// (npm run dev:mailbox -- ... does the same outside the container.)
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** 01XXXXXXXXX as the +8801XXXXXXXXX the messages are kept under. */
export function normaliseTo(to: string | undefined): string | undefined {
  if (!to) return undefined;
  const d = to.replace(/[\s-]/g, '');
  return /^01[3-9]\d{8}$/.test(d) ? `+88${d}` : d;
}

async function main(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const items = await new DevMailbox(redis).list(normaliseTo(arg('to')), Number(arg('limit') ?? 20));
    if (items.length === 0) console.log('No simulated messages (the mailbox keeps the last 200 for 7 days, in log mode only).');
    for (const m of items.reverse()) {
      console.log(`--- ${m.at}  ${m.channel.toUpperCase()} to ${m.to}  (simulated)${m.subject ? `\n${m.subject}` : ''}\n${m.text}\n`);
    }
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
