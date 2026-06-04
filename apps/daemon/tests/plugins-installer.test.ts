// Installer integration: copies a local-folder plugin into a sandbox
// userPluginsRoot, persists the installed_plugins row, and surfaces SSE
// events. Phase 1 covers exactly the local-folder source path; tarball
// arrival lands in Phase 2A.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migratePlugins } from '../src/plugins/persistence.js';
import { installFromLocalFolder, installPlugin, uninstallPlugin } from '../src/plugins/installer.js';
import { listInstalledPlugins } from '../src/plugins/registry.js';
import { addMarketplace, resolvePluginInMarketplaces } from '../src/plugins/marketplaces.js';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { doctorPlugin } from '../src/plugins/doctor.js';

let tmpRoot: string;
let pluginsRoot: string;
let sourceFolder: string;
let db: Database.Database;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'od-installer-'));
  pluginsRoot = path.join(tmpRoot, 'plugins');
  sourceFolder = path.join(tmpRoot, 'source-plugin');
  await mkdir(sourceFolder, { recursive: true });
  await writeFile(
    path.join(sourceFolder, 'open-design.json'),
    JSON.stringify({
      name: 'sample-plugin',
      version: '1.0.0',
      title: 'Sample Plugin',
      od: {
        kind: 'skill',
        taskKind: 'new-generation',
        useCase: { query: 'Make a {{topic}} brief.' },
        inputs: [{ name: 'topic', type: 'string', required: true }],
      },
    }, null, 2),
  );
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, title TEXT);
  `);
  migratePlugins(db);
});

afterEach(async () => {
  db.close();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('installFromLocalFolder', () => {
  it('copies the folder and writes installed_plugins', async () => {
    const events: string[] = [];
    let installedRecord: InstalledPluginRecord | null = null;

    for await (const ev of installFromLocalFolder(db, {
      source: sourceFolder,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      events.push(ev.kind);
      if (ev.kind === 'success') installedRecord = ev.plugin;
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    expect(events.at(-1)).toBe('success');
    expect(installedRecord?.id).toBe('sample-plugin');
    expect(installedRecord?.version).toBe('1.0.0');
    const list = listInstalledPlugins(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('sample-plugin');
    expect(list[0]?.sourceKind).toBe('local');
    expect(list[0]?.trust).toBe('restricted');
    expect(list[0]?.fsPath).toBe(path.join(pluginsRoot, 'sample-plugin'));
  });

  it('rejects symbolic links inside the source tree', async () => {
    // Create a benign symlink — the installer must refuse anything that
    // could escape the staged folder.
    const linkPath = path.join(sourceFolder, 'evil-link');
    await mkdir(path.dirname(linkPath), { recursive: true });
    const fs = await import('node:fs/promises');
    await fs.symlink('/etc/passwd', linkPath).catch(() => undefined);

    let errored = false;
    for await (const ev of installFromLocalFolder(db, {
      source: sourceFolder,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      if (ev.kind === 'error') errored = true;
    }
    expect(errored).toBe(true);
  });

  it('uninstall removes the row and on-disk staged folder', async () => {
    for await (const _ev of installFromLocalFolder(db, {
      source: sourceFolder,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      void _ev;
    }
    const result = await uninstallPlugin(db, 'sample-plugin', { userPluginsRoot: pluginsRoot });
    expect(result.ok).toBe(true);
    expect(listInstalledPlugins(db)).toHaveLength(0);
  });

  it('persists marketplace provenance and inherited trust for resolved installs', async () => {
    const lockfilePath = path.join(tmpRoot, '.od', 'od-plugin-lock.json');
    const manifest = JSON.stringify({
      specVersion: '1.0.0',
      name: 'fixture-registry',
      version: '1.0.0',
      plugins: [
        {
          name: 'vendor/sample-plugin',
          title: 'Sample Plugin',
          source: sourceFolder,
          version: '1.0.0',
          ref: 'abc123',
          integrity: 'sha512-fixture',
          manifestDigest: 'sha256-manifest',
        },
      ],
    });
    const added = await addMarketplace(db, {
      url: 'https://example.com/open-design-marketplace.json',
      trust: 'official',
      fetcher: async () => ({
        ok: true,
        status: 200,
        text: async () => manifest,
      }),
    });
    if (!added.ok) throw new Error('marketplace setup failed');

    const resolved = resolvePluginInMarketplaces(db, 'vendor/sample-plugin');
    expect(resolved).not.toBeNull();

    let installedRecord: InstalledPluginRecord | null = null;
    for await (const ev of installPlugin(db, {
      source: resolved!.source,
      roots: { userPluginsRoot: pluginsRoot },
      sourceMarketplaceId: resolved!.marketplaceId,
      sourceMarketplaceEntryName: resolved!.pluginName,
      sourceMarketplaceEntryVersion: resolved!.pluginVersion,
      marketplaceTrust: resolved!.marketplaceTrust,
      resolvedSource: resolved!.source,
      resolvedRef: resolved!.ref!,
      manifestDigest: resolved!.manifestDigest!,
      archiveIntegrity: resolved!.archiveIntegrity!,
      lockfilePath,
    })) {
      if (ev.kind === 'success') installedRecord = ev.plugin;
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    expect(installedRecord?.id).toBe('sample-plugin');
    expect(installedRecord?.sourceKind).toBe('local');
    expect(installedRecord?.sourceMarketplaceId).toBe(added.row.id);
    expect(installedRecord?.sourceMarketplaceEntryName).toBe('vendor/sample-plugin');
    expect(installedRecord?.sourceMarketplaceEntryVersion).toBe('1.0.0');
    expect(installedRecord?.marketplaceTrust).toBe('official');
    expect(installedRecord?.trust).toBe('trusted');
    expect(installedRecord?.resolvedSource).toBe(sourceFolder);
    expect(installedRecord?.resolvedRef).toBe('abc123');
    expect(installedRecord?.manifestDigest).toBe('sha256-manifest');
    expect(installedRecord?.archiveIntegrity).toBe('sha512-fixture');

    const [row] = listInstalledPlugins(db);
    expect(row?.sourceMarketplaceId).toBe(added.row.id);
    expect(row?.marketplaceTrust).toBe('official');
    expect(row?.trust).toBe('trusted');
    const lockfile = JSON.parse(await readFile(lockfilePath, 'utf8'));
    expect(lockfile.plugins['vendor/sample-plugin']).toMatchObject({
      name: 'vendor/sample-plugin',
      version: '1.0.0',
      sourceMarketplaceId: added.row.id,
      sourceMarketplaceEntryName: 'vendor/sample-plugin',
      resolvedRef: 'abc123',
      manifestDigest: 'sha256-manifest',
      archiveIntegrity: 'sha512-fixture',
    });
  });

  it('keeps restricted marketplace installs restricted', async () => {
    const manifest = JSON.stringify({
      specVersion: '1.0.0',
      name: 'restricted-registry',
      version: '1.0.0',
      plugins: [
        {
          name: 'vendor/sample-plugin',
          title: 'Sample Plugin',
          source: sourceFolder,
          version: '1.0.0',
        },
      ],
    });
    const added = await addMarketplace(db, {
      url: 'https://example.com/restricted-marketplace.json',
      trust: 'restricted',
      fetcher: async () => ({
        ok: true,
        status: 200,
        text: async () => manifest,
      }),
    });
    if (!added.ok) throw new Error('marketplace setup failed');

    const resolved = resolvePluginInMarketplaces(db, 'vendor/sample-plugin');
    expect(resolved).not.toBeNull();

    let installedRecord: InstalledPluginRecord | null = null;
    for await (const ev of installPlugin(db, {
      source: resolved!.source,
      roots: { userPluginsRoot: pluginsRoot },
      sourceMarketplaceId: resolved!.marketplaceId,
      sourceMarketplaceEntryName: resolved!.pluginName,
      sourceMarketplaceEntryVersion: resolved!.pluginVersion,
      marketplaceTrust: resolved!.marketplaceTrust,
      resolvedSource: resolved!.source,
    })) {
      if (ev.kind === 'success') installedRecord = ev.plugin;
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    expect(installedRecord?.sourceMarketplaceId).toBe(added.row.id);
    expect(installedRecord?.marketplaceTrust).toBe('restricted');
    expect(installedRecord?.trust).toBe('restricted');
    const [row] = listInstalledPlugins(db);
    expect(row?.marketplaceTrust).toBe('restricted');
    expect(row?.trust).toBe('restricted');
  });

  it('registers every declared local bundle child under the bundle namespace with one success event', async () => {
    const bundleRoot = await writeBundleFixture('my-bundle');

    const successIds: string[] = [];
    const successPluginIds: string[][] = [];
    for await (const ev of installFromLocalFolder(db, {
      source: bundleRoot,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      if (ev.kind === 'success') {
        successIds.push(ev.plugin.id);
        successPluginIds.push(ev.plugins.map((plugin) => plugin.id).sort());
      }
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    expect(successIds).toEqual(['my-bundle']);
    expect(successPluginIds).toEqual([[
      'my-bundle',
      'my-bundle/deck-pacing',
      'my-bundle/deck-skeleton',
      'my-bundle/linear-clone',
    ]]);
    const rows = listInstalledPlugins(db);
    expect(rows.map((row) => row.id).sort()).toEqual([
      'my-bundle',
      'my-bundle/deck-pacing',
      'my-bundle/deck-skeleton',
      'my-bundle/linear-clone',
    ]);
    expect(rows.every((row) => row.sourceKind === 'local')).toBe(true);
    expect(rows.find((row) => row.id === 'my-bundle/deck-skeleton')?.fsPath)
      .toBe(path.join(pluginsRoot, 'my-bundle', 'skills', 'deck-skeleton'));
  });

  it('uninstalling a bundle child removes the bundle root and sibling rows', async () => {
    const bundleRoot = await writeBundleFixture('remove-bundle');

    for await (const ev of installFromLocalFolder(db, {
      source: bundleRoot,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    const installedFolder = path.join(pluginsRoot, 'remove-bundle');
    await expect(stat(installedFolder)).resolves.toBeTruthy();

    const result = await uninstallPlugin(db, 'remove-bundle/deck-skeleton', { userPluginsRoot: pluginsRoot });

    expect(result.ok).toBe(true);
    expect(listInstalledPlugins(db)).toHaveLength(0);
    await expect(stat(installedFolder)).rejects.toThrow();
  });

  it('upgrading a bundle child emits one success event with the full installed set', async () => {
    const bundleRoot = await writeBundleFixture('upgrade-bundle', {
      version: '1.0.0',
    });

    for await (const ev of installFromLocalFolder(db, {
      source: bundleRoot,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    await writeBundleFixture('upgrade-bundle', {
      version: '2.0.0',
    });

    const successEvents: Array<{ root: string; plugins: string[]; version: string }> = [];
    for await (const ev of installPlugin(db, {
      source: bundleRoot,
      roots: { userPluginsRoot: pluginsRoot },
      eventKind: 'upgraded',
    })) {
      if (ev.kind === 'success') {
        successEvents.push({
          root: ev.plugin.id,
          plugins: ev.plugins.map((plugin) => plugin.id).sort(),
          version: ev.plugin.version,
        });
      }
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    expect(successEvents).toEqual([{
      root: 'upgrade-bundle',
      plugins: [
        'upgrade-bundle',
        'upgrade-bundle/deck-pacing',
        'upgrade-bundle/deck-skeleton',
        'upgrade-bundle/linear-clone',
      ],
      version: '2.0.0',
    }]);
    expect(listInstalledPlugins(db).map((row) => `${row.id}@${row.version}`).sort()).toEqual([
      'upgrade-bundle/deck-pacing@2.0.0',
      'upgrade-bundle/deck-skeleton@2.0.0',
      'upgrade-bundle/linear-clone@2.0.0',
      'upgrade-bundle@2.0.0',
    ]);
  });

  it('rejects unsafe bundle child paths without leaving registry rows', async () => {
    const bundleRoot = await writeBundleFixture('unsafe-bundle', {
      skills: [{ id: 'deck-skeleton', path: '../deck-skeleton' }],
    });

    let errorMessage = '';
    for await (const ev of installFromLocalFolder(db, {
      source: bundleRoot,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      if (ev.kind === 'error') errorMessage = ev.message;
    }

    expect(errorMessage).toContain('unsafe path');
    expect(listInstalledPlugins(db)).toHaveLength(0);
  });

  it('doctor resolves bundle-local skill, design-system, and craft references', async () => {
    const bundleRoot = await writeBundleFixture('doctor-bundle', {
      skillContext: true,
    });

    for await (const ev of installFromLocalFolder(db, {
      source: bundleRoot,
      roots: { userPluginsRoot: pluginsRoot },
    })) {
      if (ev.kind === 'error') throw new Error(ev.message);
    }

    const skill = listInstalledPlugins(db).find((row) => row.id === 'doctor-bundle/deck-skeleton');
    expect(skill).toBeTruthy();

    const report = doctorPlugin(skill!, {
      skills: [],
      designSystems: [],
      craft: [],
      atoms: [],
    });
    expect(report.issues.filter((issue) => issue.code === 'context.unresolved')).toEqual([]);
  });
});

async function writeBundleFixture(
  id: string,
  overrides: {
    skills?: Array<{ id: string; path: string }>;
    skillContext?: boolean;
    version?: string;
  } = {},
): Promise<string> {
  const bundleRoot = path.join(tmpRoot, id);
  await mkdir(path.join(bundleRoot, 'skills', 'deck-skeleton'), { recursive: true });
  await mkdir(path.join(bundleRoot, 'design-systems', 'linear-clone'), { recursive: true });
  await mkdir(path.join(bundleRoot, 'craft'), { recursive: true });
  await writeFile(path.join(bundleRoot, 'SKILL.md'), `# ${id}\n`);
  await writeFile(path.join(bundleRoot, 'open-design.json'), JSON.stringify({
    name: id,
    version: overrides.version ?? '1.0.0',
    title: 'Deck Bundle',
    od: {
      kind: 'bundle',
      bundle: {
        skills: overrides.skills ?? [{ id: 'deck-skeleton', path: 'skills/deck-skeleton' }],
        designSystems: [{ id: 'linear-clone', path: 'design-systems/linear-clone' }],
        craft: [{ id: 'deck-pacing', path: 'craft/deck-pacing.md' }],
      },
    },
  }, null, 2));
  await writeFile(path.join(bundleRoot, 'skills', 'deck-skeleton', 'SKILL.md'), [
    '---',
    'name: deck-skeleton',
    'description: Deck skeleton skill',
    '---',
    '# Deck Skeleton',
  ].join('\n'));
  await writeFile(path.join(bundleRoot, 'skills', 'deck-skeleton', 'open-design.json'), JSON.stringify({
    name: 'deck-skeleton',
    version: overrides.version ?? '1.0.0',
    title: 'Deck Skeleton',
    ...(overrides.skillContext ? {
      od: {
        kind: 'skill',
        context: {
          skills: [{ ref: 'deck-skeleton' }],
          designSystem: { ref: 'linear-clone' },
          craft: ['deck-pacing'],
        },
      },
    } : { od: { kind: 'skill' } }),
  }, null, 2));
  await writeFile(path.join(bundleRoot, 'design-systems', 'linear-clone', 'DESIGN.md'), '# Linear Clone\n');
  await writeFile(path.join(bundleRoot, 'craft', 'deck-pacing.md'), '# Deck Pacing\n');
  return bundleRoot;
}
