// One server clock per tab (section 4.5, FR-AUC-01). Screens that receive serverTime feed it
// (sampleHttp for responses, sampleMessage for live messages); countdowns read serverClock.now().
import { ServerClock } from '../lib/time.js';

export const serverClock = new ServerClock();
