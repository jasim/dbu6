/*
 * A small Excel (.xlsx) writer for exporting a report: plain sheets of text
 * and numbers, a bold header row and an optional bold last row for totals.
 * No formulas, charts or shared strings. An .xlsx is a zip of XML parts;
 * the zip here stores them uncompressed, which Excel, Numbers and
 * LibreOffice all open.
 */

export type XlsxCell = string | number;

export type XlsxSheet = {
  /** At most 31 characters, none of []:*?/\ (Excel's rule). */
  name: string;
  header: string[];
  rows: XlsxCell[][];
  /** Whether the last row is a totals row, set in bold. */
  totals?: boolean;
  /** Column widths in characters, by column. */
  widths?: number[];
};

const MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The workbook as a Blob, ready to download. */
export function xlsxBlob(sheets: XlsxSheet[]): Blob {
  return new Blob([new Uint8Array(xlsxBytes(sheets))], { type: MIME });
}

/** Offers the workbook to the browser as a download named `fileName`. */
export function downloadXlsx(fileName: string, sheets: XlsxSheet[]): void {
  const url = URL.createObjectURL(xlsxBlob(sheets));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function xlsxBytes(sheets: XlsxSheet[]): Uint8Array {
  const files: [string, string][] = [
    ["[Content_Types].xml", contentTypes(sheets.length)],
    ["_rels/.rels", ROOT_RELS],
    ["xl/workbook.xml", workbook(sheets)],
    ["xl/_rels/workbook.xml.rels", workbookRels(sheets.length)],
    ["xl/styles.xml", STYLES],
    ...sheets.map((sheet, index): [string, string] => [
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheet(sheet),
    ]),
  ];
  const encoder = new TextEncoder();
  return zip(files.map(([name, text]) => [name, encoder.encode(text)]));
}

// Style ids, in STYLES' cellXfs order.
const TEXT = 0;
const BOLD = 1;
const NUMBER = 2;
const BOLD_NUMBER = 3;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function contentTypes(sheetCount: number): string {
  const sheets = range(sheetCount)
    .map(
      (index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

function workbook(sheets: XlsxSheet[]): string {
  const entries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${entries}</sheets></workbook>`;
}

function workbookRels(sheetCount: number): string {
  const sheets = range(sheetCount)
    .map(
      (index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const styles = `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}${styles}</Relationships>`;
}

function worksheet(sheet: XlsxSheet): string {
  const lastRow = sheet.rows.length - 1;
  const rows = [
    row(1, sheet.header, true),
    ...sheet.rows.map((cells, index) =>
      row(index + 2, cells, sheet.totals === true && index === lastRow),
    ),
  ].join("");
  const cols =
    sheet.widths && sheet.widths.length > 0
      ? `<cols>${sheet.widths
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";
  // The header row stays in view while scrolling.
  const views = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

function row(number: number, cells: XlsxCell[], bold: boolean): string {
  const xml = cells
    .map((value, index) => {
      const ref = `${columnName(index)}${number}`;
      if (typeof value === "number") {
        return `<c r="${ref}" s="${bold ? BOLD_NUMBER : NUMBER}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" s="${bold ? BOLD : TEXT}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    })
    .join("");
  return `<row r="${number}">${xml}</row>`;
}

/** A, B, …, Z, AA, AB, … for a zero-based column. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function escapeXml(text: string): string {
  return (
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Control characters other than tab and newlines aren't allowed in XML.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  );
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

// --- zip, stored (no compression) ---

function zip(files: [string, Uint8Array][]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true); // time
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // version made by
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    // Extra, comment, disk, attributes: all zero.
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return concat([...chunks, ...central, new Uint8Array(end.buffer)]);
}

// 1 January 1980, the earliest date a zip can carry.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
