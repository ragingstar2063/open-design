const DEFAULT_LANGFUSE_BASE_URL = 'https://us.cloud.langfuse.com';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BATCH_EVENTS = 100;
const ALLOWED_EVENT_TYPES = new Set([
  'trace-create',
  'span-create',
  'generation-create',
  'event-create',
  'score-create',
]);

export interface Env {
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bodySizeBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function basicAuthHeader(publicKey: string, secretKey: string): string {
  const bytes = new TextEncoder().encode(`${publicKey}:${secretKey}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function validateIngestionBody(value: unknown): string | null {
  if (!isRecord(value)) return 'body must be a JSON object';
  const batch = value.batch;
  if (!Array.isArray(batch)) return 'body.batch must be an array';
  if (batch.length === 0) return 'body.batch must not be empty';
  if (batch.length > MAX_BATCH_EVENTS) return 'body.batch has too many events';

  for (const [index, event] of batch.entries()) {
    if (!isRecord(event)) return `body.batch[${index}] must be an object`;
    if (typeof event.id !== 'string' || event.id.length === 0) {
      return `body.batch[${index}].id must be a string`;
    }
    if (event.id.length > 200) return `body.batch[${index}].id is too long`;
    if (typeof event.type !== 'string' || !ALLOWED_EVENT_TYPES.has(event.type)) {
      return `body.batch[${index}].type is not allowed`;
    }
    if (!isRecord(event.body)) return `body.batch[${index}].body must be an object`;
  }
  return null;
}

async function readBoundedBody(request: Request): Promise<string | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength != null && Number(contentLength) > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'payload too large' });
  }

  const text = await request.text();
  if (bodySizeBytes(text) > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: 'payload too large' });
  }
  return text;
}

function resolveLangfuseUrl(env: Env): string {
  return `${(env.LANGFUSE_BASE_URL?.trim() || DEFAULT_LANGFUSE_BASE_URL).replace(/\/+$/, '')}/api/public/ingestion`;
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'method not allowed' });
  }

  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    return jsonResponse(503, { error: 'telemetry relay is not configured' });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse(415, { error: 'content-type must be application/json' });
  }

  const rawBody = await readBoundedBody(request);
  if (rawBody instanceof Response) return rawBody;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'invalid JSON' });
  }

  const validationError = validateIngestionBody(parsed);
  if (validationError != null) {
    return jsonResponse(400, { error: validationError });
  }

  const upstream = await fetch(resolveLangfuseUrl(env), {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(publicKey, secretKey),
      'Content-Type': 'application/json',
    },
    body: rawBody,
  });
  const upstreamBody = await upstream.text();
  return new Response(upstreamBody, {
    status: upstream.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}

export default {
  fetch: handleRequest,
};
