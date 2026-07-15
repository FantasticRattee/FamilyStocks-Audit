const SHEET_NAME = "Market";
const REQUIRED_CURRENCIES = {
  GOOGL: "USD",
  USDTHB: "THB",
};

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return jsonResponse({
      error: "Missing Market sheet. See the dashboard README setup table.",
    });
  }

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    return jsonResponse({ error: "Market sheet has no quote rows." });
  }

  const headers = rows[0].map((header) => String(header).trim().toLowerCase());
  const keyIndex = headers.indexOf("key");
  const priceIndex = headers.indexOf("price");
  const currencyIndex = headers.indexOf("currency");
  const timestampIndex = headers.indexOf("quote timestamp");
  if (keyIndex < 0 || priceIndex < 0 || currencyIndex < 0) {
    return jsonResponse({
      error: "Market sheet requires Key, Price, and Currency headers.",
    });
  }

  const fetchedAt = new Date().toISOString();
  const quotes = {};
  rows.slice(1).forEach((row) => {
    const key = String(row[keyIndex] || "").trim().toUpperCase();
    const expectedCurrency = REQUIRED_CURRENCIES[key];
    if (!expectedCurrency) return;

    const price = Number(row[priceIndex]);
    const currency = String(row[currencyIndex] || "").trim().toUpperCase();
    if (!Number.isFinite(price) || price <= 0 || currency !== expectedCurrency) {
      return;
    }

    const timestampValue = timestampIndex >= 0 ? row[timestampIndex] : null;
    quotes[key] = {
      price: price,
      currency: currency,
      quoteTimestamp: isoTimestamp(timestampValue, fetchedAt),
    };
  });

  return jsonResponse({ fetchedAt: fetchedAt, quotes: quotes });
}

function isoTimestamp(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
