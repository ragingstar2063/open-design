# Open Design Telemetry Relay

Cloudflare Worker relay for opt-in Open Design telemetry. The shipped desktop
client sends redacted Langfuse ingestion batches here after the user enables
metrics. This Worker holds the Langfuse write credentials and forwards valid
batches to Langfuse.

## Secrets

```bash
pnpm --dir apps/telemetry-worker dlx wrangler secret put LANGFUSE_PUBLIC_KEY
pnpm --dir apps/telemetry-worker dlx wrangler secret put LANGFUSE_SECRET_KEY
```

`LANGFUSE_BASE_URL` defaults to `https://us.cloud.langfuse.com` in
`wrangler.toml`.

## Deploy

```bash
pnpm --filter @open-design/telemetry-worker deploy
```

After deploy, set the repository variable `OPEN_DESIGN_TELEMETRY_RELAY_URL` to
the Worker route, for example:

```text
https://telemetry.open-design.ai/api/langfuse
```

Release workflows bake only this public relay URL into packaged config. The
Langfuse secret key stays in Cloudflare Worker secrets.
