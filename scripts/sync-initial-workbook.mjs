import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(scriptDir, "..");
const workbookPath = path.resolve(dashboardDir, "..", "Portfolio_Accounting.xlsx");
const outputPath = path.resolve(dashboardDir, "app", "dashboard", "initial-workbook.ts");

if (!fs.existsSync(workbookPath)) {
  throw new Error(`Canonical workbook not found: ${workbookPath}`);
}

const base64 = fs.readFileSync(workbookPath).toString("base64");
const chunks = base64.match(/.{1,120}/g) ?? [];
const generated = [
  "// Generated from the canonical Portfolio_Accounting.xlsx. Do not edit manually.",
  "// Fallback only: live dashboard data is loaded from the shared PostgreSQL portfolio.",
  "export const INITIAL_WORKBOOK_BASE64 = [",
  ...chunks.map((chunk) => `  ${JSON.stringify(chunk)},`),
  "].join(\"\");",
  "",
].join("\n");

fs.writeFileSync(outputPath, generated);
console.log(`Synced ${chunks.length} base64 chunks from ${workbookPath}`);
