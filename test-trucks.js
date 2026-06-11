// Test utilities - extracted pure functions from trucks.js
// These don't depend on browser APIs

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTruckRecord(row) {
  return {
    id: row.id,
    truckNumber: String(row.truckNumber ?? "").trim(),
    registration: String(row.registration ?? "").trim(),
    model: String(row.model ?? "").trim(),
    capacity: Number(row.capacity || 0),
    serviceDueDate: String(row.serviceDueDate ?? ""),
    regoExpiryDate: String(row.regoExpiryDate ?? ""),
    status: String(row.status ?? ""),
    notes: String(row.notes ?? "").trim()
  };
}

function formatSearchDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = String(value).split("-");
  return `${day}/${month}/${year}`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value);
    if (text.trim() !== "") return value;
  }
  return "";
}

function coerceNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback || 0);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function formatTruckRetryDelay(ms) {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function formatTruckAttachmentSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

// ============ TESTS ============

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  assert(passed, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

console.log("🧪 Running trucks.js unit tests...\n");

// Test normalizeSearchValue
console.log("Testing normalizeSearchValue:");
assertEqual(normalizeSearchValue("TRUCK 840"), "truck 840", "normalizes uppercase");
assertEqual(normalizeSearchValue("  spaces  "), "spaces", "trims whitespace");
assertEqual(normalizeSearchValue(null), "", "handles null");
assertEqual(normalizeSearchValue(""), "", "handles empty string");

// Test normalizeTruckRecord
console.log("\nTesting normalizeTruckRecord:");
const testTruck = {
  id: "test-123",
  truckNumber: "  840  ",
  registration: "XW46EK",
  model: "ISUZU",
  capacity: 8,
  serviceDueDate: "2026-04-10",
  regoExpiryDate: "2026-04-29",
  status: "Available",
  notes: "  test notes  "
};
const normalized = normalizeTruckRecord(testTruck);
assert(normalized.truckNumber === "840", "trims truck number");
assert(normalized.notes === "test notes", "trims notes");
assert(normalized.capacity === 8, "preserves capacity as number");

// Test formatSearchDate
console.log("\nTesting formatSearchDate:");
assertEqual(formatSearchDate("2026-04-29"), "29/04/2026", "formats valid date");
assertEqual(formatSearchDate("invalid"), "", "returns empty for invalid date");
assertEqual(formatSearchDate(null), "", "handles null");

// Test firstNonEmpty
console.log("\nTesting firstNonEmpty:");
assertEqual(firstNonEmpty(null, "  ", "value"), "value", "returns first non-empty value");
assertEqual(firstNonEmpty("first", "second"), "first", "returns first value");
assertEqual(firstNonEmpty(null, null), "", "returns empty string if all null");

// Test coerceNumber
console.log("\nTesting coerceNumber:");
assertEqual(coerceNumber("42"), 42, "converts string to number");
assertEqual(coerceNumber("abc", 10), 10, "uses fallback for invalid");
assertEqual(coerceNumber(null, 5), 5, "uses fallback for null");
assertEqual(coerceNumber(Infinity), 0, "converts Infinity to 0");

// Test isUuid
console.log("\nTesting isUuid:");
assert(isUuid("550e8400-e29b-41d4-a716-446655440000"), "validates correct UUID");
assert(!isUuid("not-a-uuid"), "rejects invalid UUID");
assert(!isUuid(null), "rejects null");
assert(!isUuid(""), "rejects empty string");

// Test formatTruckRetryDelay
console.log("\nTesting formatTruckRetryDelay:");
assertEqual(formatTruckRetryDelay(2000), "2s", "formats milliseconds as seconds");
assertEqual(formatTruckRetryDelay(60000), "1m", "formats minutes");
assertEqual(formatTruckRetryDelay(90000), "2m", "rounds up minutes");

// Test formatTruckAttachmentSize
console.log("\nTesting formatTruckAttachmentSize:");
assertEqual(formatTruckAttachmentSize(512), "512 B", "formats bytes");
assertEqual(formatTruckAttachmentSize(1024), "1 KB", "formats kilobytes");
assertEqual(formatTruckAttachmentSize(1048576), "1.0 MB", "formats megabytes");
assertEqual(formatTruckAttachmentSize(0), "0 B", "handles zero");

// Summary
console.log("\n" + "=".repeat(50));
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log("=".repeat(50));

process.exit(testsFailed > 0 ? 1 : 0);
