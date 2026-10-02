import { readdir, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("supabase/production-migration-ledger.json", "utf8"));
const files = await readdir("supabase/migrations");
const localVersions = new Set(
  files
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 14)),
);

const listedLocalOnly = new Set([
  ...(manifest.local_history_not_recorded_in_production ?? []),
  ...(manifest.release_pending ?? []),
]);
const reconstructed = new Set(manifest.source_reconstructed_from_live_schema ?? []);
const externalGap = new Set(manifest.external_baseline_gap ?? []);
const production = new Set(manifest.production_applied ?? []);

const errors = [];

for (const version of production) {
  if (!localVersions.has(version) && !externalGap.has(version)) {
    errors.push(`production migration ${version} is neither present locally nor documented as an external baseline gap`);
  }
}

for (const version of reconstructed) {
  if (!localVersions.has(version)) {
    errors.push(`reconstructed production migration ${version} is missing from supabase/migrations`);
  }
}

for (const version of externalGap) {
  if (!production.has(version)) {
    errors.push(`external baseline gap ${version} is not recorded in production history`);
  }
}

for (const version of localVersions) {
  if (production.has(version)) continue;
  if (listedLocalOnly.has(version)) continue;

  // Old non-timestamp migration names (8-digit dates) are outside this
  // reconciliation ledger and are intentionally ignored here.
  errors.push(`local migration ${version} is not accounted for in production-migration-ledger.json`);
}

for (const version of listedLocalOnly) {
  if (!localVersions.has(version)) {
    errors.push(`ledger lists local migration ${version}, but no matching SQL file exists`);
  }
}

if (errors.length) {
  console.error("Supabase migration ledger drift detected:");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(
  `Supabase migration ledger OK: ${production.size} production versions tracked, ${reconstructed.size} reconstructed, ${externalGap.size} baseline gaps explicitly documented.`,
);
