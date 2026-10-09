export type PartnerExportRow = {
  estado: string;
  cliente: string;
  servicio: string;
  telefono: string;
  zip: string;
  recibido: string;
  antiguedad: string;
  proximoSeguimiento: string;
};

const HEADERS = ["Estado", "Cliente", "Servicio", "Teléfono", "ZIP", "Recibido", "Antigüedad", "Próximo seguimiento"] as const;

function rowValues(row: PartnerExportRow): string[] {
  return [row.estado, row.cliente, row.servicio, row.telefono, row.zip, row.recibido, row.antiguedad, row.proximoSeguimiento];
}

function safeSpreadsheetText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = safeSpreadsheetText(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildPartnerCsv(rows: PartnerExportRow[]): string {
  const lines = [HEADERS.map(csvCell).join(","), ...rows.map((row) => rowValues(row).map(csvCell).join(","))];
  return `\uFEFF${lines.join("\r\n")}`;
}

function xmlEscape(value: string): string {
  return safeSpreadsheetText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheetXml(rows: PartnerExportRow[]): string {
  const values = [Array.from(HEADERS), ...rows.map(rowValues)];
  const body = values.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

type ZipEntry = { name: string; data: Uint8Array; crc: number; offset: number };
const encoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function buildZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(header, data);
    entries.push({ name: file.name, data, crc, offset });
    offset += header.length + data.length;
  }

  const centralOffset = offset;
  const centralParts: Uint8Array[] = [];
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const header = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(entry.crc), u32(entry.data.length), u32(entry.data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), name,
    ]);
    centralParts.push(header);
    offset += header.length;
  }

  const centralSize = offset - centralOffset;
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralSize), u32(centralOffset), u16(0),
  ]);
  return concat([...localParts, ...centralParts, end]);
}

export function buildPartnerXlsx(rows: PartnerExportRow[]): Uint8Array {
  return buildZip([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mi trabajo" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(rows) },
  ]);
}
