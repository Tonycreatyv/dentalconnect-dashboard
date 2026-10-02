import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = [
  "src/apps/referral-hub",
  "src/apps/referral-partner",
];

const FORBIDDEN = [
  "lead_assignments",
  '.from("partners")',
  ".from('partners')",
  "partner_recomendado",
  "useReferralData",
];

async function walk(path, files = []) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of await walk(root)) {
    const source = await readFile(file, "utf8");
    for (const forbidden of FORBIDDEN) {
      if (source.includes(forbidden)) violations.push(`${file}: ${forbidden}`);
    }
  }
}

if (violations.length) {
  console.error("ConeXXion V2 architecture boundary violated:");
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}
console.log("ConeXXion V2 architecture boundary OK.");
