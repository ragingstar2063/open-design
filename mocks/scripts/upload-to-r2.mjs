#!/usr/bin/env node
/**
 * R2 sync — called by `.github/workflows/sync-mocks-to-r2.yml` after
 * merge to main. Picks up `.jsonl` files in mocks/recordings-staging/,
 * uploads each to R2, updates mocks/manifest.json, and writes the
 * updated manifest back to R2.
 *
 * Not intended for local invocation. Talks to R2 via the S3-compatible
 * API using AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env (sourced from
 * the CLOUDFLARE_R2_MOCKS_AK / _SK repo secrets). R2_S3_ENDPOINT must
 * also be set. If you need to test the upload path locally, configure
 * those env vars yourself AND set
 * env SYNCLO_OD_MOCKS_I_KNOW_WHAT_IM_DOING=1 to bypass the safety gate.
 *
 * Why not wrangler: wrangler 4.x calls /memberships before any R2
 * action, which requires user:read scope. R2 "Object Read & Write"
 * tokens deliberately lack that scope (defense in depth — a leaked
 * token shouldn't enumerate account-level resources). aws CLI talks
 * straight to the S3 endpoint with SigV4, no membership lookup.
 *
 * Atomic ordering:
 *   1. Validate every staging .jsonl (parse meta, sha256, size)
 *      → abort the whole run if any is malformed; no partial state
 *   2. Upload each to R2 (parallel, capped at 4 concurrent)
 *   3. Mutate manifest in-memory
 *   4. Upload updated manifest to R2
 *   5. Delete the staging files (caller commits + pushes manifest back)
 */

import { readdir, unlink, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectRecording,
  upsertEntry,
  readManifest,
  writeManifest,
} from './lib/manifest-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKS_DIR = dirname(HERE);
const STAGING_DIR = join(MOCKS_DIR, 'recordings-staging');
const MANIFEST_PATH = join(MOCKS_DIR, 'manifest.json');
const BUCKET = 'open-design-mocks';
const KEY_PREFIX = 'recordings/v1/';
const CONCURRENCY = 4;

function checkEnv() {
  const isCi = process.env.GITHUB_ACTIONS === 'true';
  const hasOverride = process.env.SYNCLO_OD_MOCKS_I_KNOW_WHAT_IM_DOING === '1';
  if (!isCi && !hasOverride) {
    console.error('✗ upload-to-r2.mjs is intended for the GitHub Action.');
    console.error('  To upload from your laptop you must explicitly opt-in:');
    console.error('    SYNCLO_OD_MOCKS_I_KNOW_WHAT_IM_DOING=1 node mocks/scripts/upload-to-r2.mjs');
    process.exit(2);
  }
  for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT']) {
    if (!process.env[k]) {
      console.error(`✗ ${k} must be set.`);
      process.exit(2);
    }
  }
  // aws CLI defaults to us-east-1, R2 wants "auto"; harmless to pin here.
  if (!process.env.AWS_REGION) process.env.AWS_REGION = 'auto';
}

function aws(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('aws', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`aws ${args.slice(0, 3).join(' ')} exit ${code}: ${stderr || stdout}`));
    });
  });
}

async function uploadObject(localPath, key) {
  await aws([
    's3api', 'put-object',
    '--endpoint-url', process.env.R2_S3_ENDPOINT,
    '--bucket', BUCKET,
    '--key', key,
    '--body', localPath,
  ]);
}

async function gatherStaging() {
  let entries;
  try {
    entries = await readdir(STAGING_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith('.jsonl')) continue;
    const path = join(STAGING_DIR, f);
    const st = await stat(path);
    if (!st.isFile()) continue;
    out.push(path);
  }
  return out.sort();
}

/** Parallel work pool with bounded concurrency. */
async function parallel(items, limit, fn) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  checkEnv();

  // Step 1: validate every staged recording. Abort entire run if any is bad.
  const stagingPaths = await gatherStaging();
  if (stagingPaths.length === 0) {
    console.log('no staging files — nothing to upload.');
    return;
  }
  console.log(`validating ${stagingPaths.length} staged recordings…`);
  const previews = stagingPaths.map(p => {
    try {
      return { path: p, entry: inspectRecording(p) };
    } catch (err) {
      console.error(`✗ ${p}: ${err.message}`);
      throw new Error(`validation failed; aborting before any R2 writes`);
    }
  });

  // Step 2: upload each to R2 (parallel, bounded).
  console.log(`uploading to R2 (concurrency=${CONCURRENCY})…`);
  await parallel(previews, CONCURRENCY, async (p) => {
    const key = `${KEY_PREFIX}${p.entry.trace_id}.jsonl`;
    await uploadObject(p.path, key);
    console.log(`  ✓ ${p.entry.trace_id} (${p.entry.bytes}B sha256=${p.entry.sha256.slice(0, 12)}…)`);
  });

  // Step 3: rebuild manifest with each entry inserted.
  console.log('updating manifest…');
  const manifest = readManifest(MANIFEST_PATH);
  for (const p of previews) upsertEntry(manifest, p.entry);
  writeManifest(MANIFEST_PATH, manifest);

  // Step 4: upload updated manifest to R2 so consumers see new entries
  // without waiting for the next git push.
  console.log('uploading manifest to R2…');
  await uploadObject(MANIFEST_PATH, `${KEY_PREFIX}manifest.json`);

  // Step 5: remove the staging files locally so the post-run commit
  // step clears the staging dir back to empty.
  console.log('clearing staging…');
  for (const p of previews) await unlink(p.path);

  console.log('');
  console.log(`✅ uploaded ${previews.length} recordings.`);
  console.log(`   manifest now has ${manifest.total} entries (${(manifest.total_bytes/1024).toFixed(0)} KB total)`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
