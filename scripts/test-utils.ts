/**
 * Smoke tests for BELLA 6.0 zero-dependency utilities.
 * Run: npm test
 */
import assert from "assert";
import { createZip, readZip, createPdfBytes } from "../bella/util";
import { buildDocx, buildXlsx, excelAddRow, excelSetCell } from "../bella/documents";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bella-test-"));
let passed = 0;
function ok(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

// --- zip roundtrip ---
ok("zip roundtrip", () => {
  const buf = createZip({ "a.txt": "hello bella", "dir/b.json": '{"x":1}' });
  const out = readZip(buf);
  assert.strictEqual(out["a.txt"].toString(), "hello bella");
  assert.strictEqual(out["dir/b.json"].toString(), '{"x":1}');
});

// --- docx structure ---
ok("docx contains document.xml + content types", () => {
  const docx = buildDocx("Test Doc", [{ heading: "Sec", body: "Line one\nLine two" }]);
  const parts = readZip(docx);
  assert.ok(parts["word/document.xml"]!.includes("Test Doc"));
  assert.ok(parts["[Content_Types].xml"]!.includes("wordprocessingml.document.main+xml"));
});

// --- xlsx write + edit roundtrip ---
ok("xlsx add row / set cell", () => {
  const p = path.join(tmp, "book.xlsx");
  fs.writeFileSync(p, buildXlsx([{ name: "Sheet1", rows: [["Name", "Amount"], ["a", "1"]] }]));
  const { rowNumber } = excelAddRow(p, undefined, "b,2.5");
  assert.strictEqual(rowNumber, 3);
  excelSetCell(p, undefined, "B1", "Total");
  const sheet = readZip(fs.readFileSync(p))["xl/worksheets/sheet1.xml"]!.toString();
  assert.ok(sheet.includes("<v>2.5</v>"), "numeric row present");
  assert.ok(sheet.includes(">Total<"), "edited cell present");
});

// --- pdf sanity ---
ok("pdf header/trailer", () => {
  const pdf = createPdfBytes("Report", [{ heading: "H", body: "Body text ".repeat(200) }]);
  const s = pdf.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.ok(s.includes("/Type /Catalog"));
});

console.log(`\n${passed} tests passed.`);
