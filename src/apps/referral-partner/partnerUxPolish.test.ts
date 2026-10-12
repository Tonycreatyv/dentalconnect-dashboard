function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

const dashboard = await Deno.readTextFile(new URL("./PartnerDashboard.tsx", import.meta.url));
const styles = await Deno.readTextFile(new URL("../../index.css", import.meta.url));

Deno.test("partner work filters keep the status tabs, service selector, and received date behind more filters", () => {
  assert(dashboard.indexOf("partner-work-summary") < dashboard.indexOf("partner-filter-controls"));
  for (const label of ["Todos", "Nuevos", "Seguimiento", "Aprobados", "No calificó"]) assert(dashboard.includes(`label: \"${label}\"`));
  assert(dashboard.includes('className="partner-service-select"'));
  assert(dashboard.includes('<details className="partner-more-filters">'));
  assertEquals(dashboard.includes('<details className="partner-more-filters" open'), false);
  assert(dashboard.includes("Fecha recibida"));
  assert(dashboard.includes('downloadPartnerExport(filtered, "xlsx")'));
  assert(dashboard.includes('downloadPartnerExport(filtered, "csv")'));
});

Deno.test("partner filter controls are responsive without wrapping mobile status chips", () => {
  assert(styles.includes(".partner-status-tabs{display:flex;min-width:0;flex:1;flex-wrap:nowrap;overflow-x:auto"));
  assert(styles.includes("@media(max-width:639px){.partner-primary-filters{display:grid"));
  assert(styles.includes(".partner-service-select{width:100%;min-width:0}"));
});
