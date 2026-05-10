import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "../members_template.csv.xlsx";
const input = await FileBlob.load(inputPath);
const wb = await SpreadsheetFile.importXlsx(input);

const overview = await wb.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 12000,
  tableMaxRows: 10,
  tableMaxCols: 12,
});

console.log(overview.ndjson);
