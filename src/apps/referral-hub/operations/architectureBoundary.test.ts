import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOTS = [
  "src/apps/referral-hub",
  "src/apps/referral-partner",
];

const FORBIDDEN = [
  "lead_assignments",
  '.from("partners")',
  ".from('partners')",
  "partner_recomendado",
];

async function collectTsFiles(path: string, out: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(path)) {
    const full = `${path}/${entry.name}`;
    if (entry.isDirectory) await collectTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

Deno.test("ConeXXion V2 app surface does not write through legacy referral model", async () => {
  const violations: string[] = [];
  for (const root of ROOTS) {
    const files = await collectTsFiles(root);
    for (const file of files) {
      const source = await Deno.readTextFile(file);
      for (const forbidden of FORBIDDEN) {
        if (source.includes(forbidden)) violations.push(`${file}: ${forbidden}`);
      }
    }
  }
  assertEquals(violations, []);
});
