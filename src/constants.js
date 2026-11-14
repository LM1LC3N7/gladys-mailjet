// -----------------------------------------------------------------------------
// Fixed values: the Mailjet endpoint and the limits the integration holds
// itself to (sizes, delays, the hourly limit range).
// -----------------------------------------------------------------------------

/** Send API v3.1 (https://dev.mailjet.com/docs/email-api/send-api-v31/). */
export const API_URL = 'https://api.mailjet.com/v3.1/send';

export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = { SEND: 'send_email' };

// The hourly limit of e-mails (scene actions and Gladys messages together).
export const DEFAULT_HOURLY_LIMIT = 20;
export const MIN_HOURLY_LIMIT = 1;
export const MAX_HOURLY_LIMIT = 200;
export const HOUR_MS = 60 * 60 * 1000;

// Sizes.
export const MAX_TEXT = 20_000; // characters of the body (Gladys messages: 4,096)
export const MAX_SUBJECT = 200; // characters of the subject
export const MAX_NAME = 100; // characters of the sender name
export const MAX_EMAIL = 254; // characters of an address (RFC 5321)
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // a camera image is ≤ 150 KB
export const MAX_RESPONSE_BYTES = 64 * 1024;

// Delays.
export const SCENE_DEADLINE_MS = 25_000; // the scene action declares 30 s
export const TEST_DEADLINE_MS = 25_000; // the Test button declares 30 s
export const REQUEST_TIMEOUT_MS = 20_000; // one HTTP request, at most
// Gladys waits 5 s for the ack of a message: the answer is given before 3.5 s,
// the request then goes on in the background (never sent twice).
export const MESSAGE_ACK_MS = 3_500;
export const MESSAGE_READY_MS = 1_000; // configuration and /data, on that path
export const CONFIG_WAIT_MS = 3_000;
export const CONFIG_RETRY_MIN_MS = 5_000;
export const CONFIG_RETRY_MAX_MS = 60_000;
export const STORE_LOAD_BUDGET_MS = 1_000;
export const STORE_RETRY_MS = 10_000;
export const SAVE_BUDGET_MS = 1_000;

// Pauses after a throttling (429) or a server error (5xx).
export const PAUSE_MIN_MS = 60_000;
export const PAUSE_MAX_MS = 60 * 60 * 1000;
export const RETRY_AFTER_MAX_MS = 6 * 60 * 60 * 1000;

// Requests at once, and waiting for a slot.
export const MAX_IN_FLIGHT = 2;
export const MAX_WAITING = 10;
