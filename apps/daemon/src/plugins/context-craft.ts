import type { InstalledPluginRecord } from '@open-design/contracts';

export function getPluginContextCraft(plugin: InstalledPluginRecord): string[] {
  const declared = plugin.manifest.od?.context?.craft;
  if (!Array.isArray(declared) || declared.length === 0) return [];

  const seen = new Set<string>();
  const craft: string[] = [];
  for (const entry of declared) {
    if (typeof entry !== 'string') continue;
    const slug = entry.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    craft.push(slug);
  }
  return craft;
}
