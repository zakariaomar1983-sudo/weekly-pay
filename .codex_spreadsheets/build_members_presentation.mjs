import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = path.resolve("..", "members_template.csv.xlsx");
const outputDir = path.resolve(".", "outputs");
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "members_template_presentation_ready.xlsx");

const inputBlob = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(inputBlob);

const sheetInfo = await workbook.inspect({ kind: "sheet", include: "id,name" });
const sheetLines = sheetInfo.ndjson.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const existingNames = new Set(sheetLines.map((x) => x.name).filter(Boolean));

const rawSheetName = "members_template";

function getOrCreateSheet(name) {
  if (existingNames.has(name)) return workbook.worksheets.getItem(name);
  existingNames.add(name);
  return workbook.worksheets.add(name);
}

function clearSheet(sheet) {
  const used = sheet.getUsedRange();
  if (used) used.clear({ applyTo: "all" });
  if (sheet.charts && sheet.charts.items && sheet.charts.items.length > 0) {
    sheet.charts.deleteAll();
  }
  if (sheet.deleteAllDrawings) sheet.deleteAllDrawings();
}

const membersView = getOrCreateSheet("Members_View");
clearSheet(membersView);

membersView.getRange("A1:E1").values = [[
  "Group Email",
  "Member Email",
  "Membership Type",
  "Membership Role",
  "Completion Status",
]];

membersView.getRange("A2:E2").formulas = [[
  `=IF(B2="", "", IF(${rawSheetName}!A2<>"", ${rawSheetName}!A2, A1))`,
  `=${rawSheetName}!B2`,
  `=${rawSheetName}!C2`,
  `=${rawSheetName}!D2`,
  `=IF(B2="","",IF(AND(C2<>"",D2<>""),"Complete",IF(AND(C2="",D2=""),"Missing type and role",IF(C2="","Missing type","Missing role"))))`,
]];
membersView.getRange("A2:E500").fillDown();

membersView.getRange("A1:E1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
};

membersView.getRange("A:E").format = { wrapText: false };
membersView.getRange("E2:E500").format = { wrapText: true };

membersView.getRange("A:A").format.columnWidthPx = 220;
membersView.getRange("B:B").format.columnWidthPx = 240;
membersView.getRange("C:D").format.columnWidthPx = 150;
membersView.getRange("E:E").format.columnWidthPx = 220;

membersView.freezePanes.freezeRows(1);

const summary = getOrCreateSheet("Summary");
clearSheet(summary);

summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Members Template Summary"]];
summary.getRange("A1").format = {
  fill: "#0B6E4F",
  font: { bold: true, color: "#FFFFFF" },
};

summary.getRange("A3:A8").values = [["Total member rows"],["Unique member emails"],["Rows missing member type"],["Rows missing member role"],["Rows with group email present"],["Rows without group email"]];
summary.getRange("B3:B8").formulas = [[`=COUNTIFS(${rawSheetName}!B2:B500,"<>")`],[`=COUNTA(UNIQUE(FILTER(${rawSheetName}!B2:B500,${rawSheetName}!B2:B500<>"")))`],[`=COUNTIFS(${rawSheetName}!B2:B500,"<>",${rawSheetName}!C2:C500,"")`],[`=COUNTIFS(${rawSheetName}!B2:B500,"<>",${rawSheetName}!D2:D500,"")`],[`=COUNTIFS(${rawSheetName}!B2:B500,"<>",${rawSheetName}!A2:A500,"<>")`],[`=COUNTIFS(${rawSheetName}!B2:B500,"<>",${rawSheetName}!A2:A500,"")`]];

summary.getRange("A3:A8").format = { fill: "#F4F8FD", font: { bold: true } };
summary.getRange("B3:B8").format = { numberFormat: "0" };

summary.getRange("D3:E3").values = [["Completion Metric", "Count"]];
summary.getRange("D4:E6").values = [["Member emails present", null],["Member type present", null],["Member role present", null]];
summary.getRange("E4:E6").formulas = [["=B3"],["=B3-B5"],["=B3-B6"]];
summary.getRange("D3:E3").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" } };

const chart = summary.charts.add("bar", summary.getRange("D3:E6"));
chart.title = "Field Completion Overview";
chart.hasLegend = false;
chart.setPosition("G3", "N16");

summary.getRange("A10").values = [["Assumptions & Notes"]];
summary.getRange("A10").format = { font: { bold: true, color: "#0B6E4F" } };
summary.getRange("A11:A14").values = [["1) Rows are counted only when Member Email is filled."],["2) Group Email is carried forward in Members_View when blank in raw data."],["3) Summary metrics evaluate rows 2 through 500 to leave growth room."],["4) Raw source sheet values are preserved exactly as imported."]];
summary.getRange("A11:A14").format = { wrapText: true };

summary.getRange("A:A").format.columnWidthPx = 430;
summary.getRange("B:B").format.columnWidthPx = 140;
summary.getRange("C:C").format.columnWidthPx = 30;
summary.getRange("D:D").format.columnWidthPx = 220;
summary.getRange("E:E").format.columnWidthPx = 100;
summary.getRange("F:N").format.columnWidthPx = 90;
summary.getRange("A10:A14").format.rowHeightPx = 26;

summary.freezePanes.freezeRows(2);

await workbook.render({ sheetName: rawSheetName, range: "A1:D10", scale: 1 });
await workbook.render({ sheetName: "Members_View", range: "A1:E18", scale: 1 });
await workbook.render({ sheetName: "Summary", range: "A1:N18", scale: 1 });

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 200 },
  summary: "formula error scan",
});

const outBlob = await SpreadsheetFile.exportXlsx(workbook);
await outBlob.save(outputPath);

console.log(JSON.stringify({ outputPath, errors: errorScan.ndjson }));
