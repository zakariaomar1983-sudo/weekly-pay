import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const original = await SpreadsheetFile.importXlsx(await FileBlob.load("../members_template.csv.xlsx"));
const updated = await SpreadsheetFile.importXlsx(await FileBlob.load("../members_template_presentation.xlsx"));

const o = await original.inspect({ kind: "table", sheetId: "members_template", range: "A1:D500", include: "values", tableMaxRows: 500, tableMaxCols: 4, maxChars: 20000 });
const u = await updated.inspect({ kind: "table", sheetId: "members_template", range: "A1:D500", include: "values", tableMaxRows: 500, tableMaxCols: 4, maxChars: 20000 });

console.log(o.ndjson === u.ndjson ? "RAW_MATCH" : "RAW_DIFF");

const sheets = await updated.inspect({ kind: "sheet", include: "id,name" });
console.log(sheets.ndjson);
