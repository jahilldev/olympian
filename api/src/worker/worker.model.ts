import { hostname } from 'node:os';

/** Stable-ish id for this worker process, used as the task lock owner. */
export const WORKER_ID = `${hostname()}#${process.pid}`;
