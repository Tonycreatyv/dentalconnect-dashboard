export type PartnerExportRow = {
  customer: string;
  phone: string;
  service: string;
  received: string;
  status: string;
  nextFollowUp: string;
};

const HEADERS: Array<keyof PartnerExportRow> = ["customer", "phone", "service", "received", "status", "nextFollowUp"];

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function partnerCasesCsv(rows: readonly PartnerExportRow[]) {
  return [HEADERS.join(","), ...rows.map((row) => HEADERS.map((key) => csvCell(row[key])).join(","))].join("\r\n");
}

function crc32(input: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of input) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipStored(files: Array<{ name: string; body: string }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: Array<{ name: Uint8Array; body: Uint8Array; crc: number; offset: number }> = [];
  let offset = 0;
  const write = (size: number, setup: (view: DataView) => void) => {
    const bytes = new Uint8Array(size); setup(new DataView(bytes.buffer)); chunks.push(bytes); offset += size;
  };
  for (const file of files) {
    const name = encoder.encode(file.name); const body = encoder.encode(file.body); const crc = crc32(body);
    entries.push({ name, body, crc, offset });
    write(30, (view) => { view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint32(14, crc, true); view.setUint32(18, body.length, true); view.setUint32(22, body.length, true); view.setUint16(26, name.length, true); });
    chunks.push(name, body); offset += name.length + body.length;
  }
  const centralOffset = offset;
  for (const entry of entries) {
    write(46, (view) => { view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true); view.setUint32(16, entry.crc, true); view.setUint32(20, entry.body.length, true); view.setUint32(24, entry.body.length, true); view.setUint16(28, entry.name.length, true); view.setUint32(42, entry.offset, true); });
    chunks.push(entry.name); offset += 46 + entry.name.length;
  }
  const centralSize = offset - centralOffset;
  write(22, (view) => { view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, centralOffset, true); });
  return new Blob(chunks as unknown as BlobPart[], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function partnerCasesXlsx(rows: readonly PartnerExportRow[]) {
  const sheetRows = [HEADERS.map((key) => key === "nextFollowUp" ? "Next follow-up" : key[0].toUpperCase() + key.slice(1)), ...rows.map((row) => HEADERS.map((key) => row[key]))]
    .map((cells, rowIndex) => `<row r="${rowIndex + 1}">${cells.map((cell, col) => `<c r="${String.fromCharCode(65 + col)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`).join("")}</row>`).join("");
  return zipStored([
    { name: "[Content_Types].xml", body: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: "_rels/.rels", body: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", body: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cases" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", body: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", body: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
}

export function downloadPartnerCases(content: Blob, filename: string) {
  const browser = globalThis as unknown as { document: { createElement: (tag: string) => { href: string; download: string; click: () => void } } };
  const url = URL.createObjectURL(content); const link = browser.document.createElement("a");
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
