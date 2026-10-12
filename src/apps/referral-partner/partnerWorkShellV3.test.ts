function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message || "Assertion failed");
}

const shell = await Deno.readTextFile(new URL("./PartnerWorkShellV3.tsx", import.meta.url));
const styles = await Deno.readTextFile(new URL("./partnerV3.css", import.meta.url));

Deno.test("partner work shell exposes functional status chips before secondary filters", () => {
  assert(shell.indexOf("partner-v3-status-tabs") < shell.indexOf("partner-modern-toolbar"));
  for (const label of ["Todos", "Nuevos", "Seguimiento", "Aprobados", "No calificó"]) assert(shell.includes(`label: \"${label}\"`));
  assert(shell.includes("onClick={() => chooseStatus(tab.id)}"));
  assert(shell.includes("partner-modern-service-filter"));
  assert(shell.includes("partner-modern-date-filter"));
  assert(shell.includes("partner-modern-export"));
});

Deno.test("partner work shell status chips retain horizontal scrolling and teal active state", () => {
  assert(styles.includes(".partner-v3-status-tabs{display:flex;gap:.45rem;overflow-x:auto"));
  assert(styles.includes(".partner-v3-status-tabs button.is-active{border-color:#3b9b79"));
});
