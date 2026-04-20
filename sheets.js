import { google } from 'googleapis';
import { readFileSync } from 'fs';

let _authClient = null;
let _sheetsClient = null;

async function getAuthClient() {
  if (_authClient) return _authClient;

  let credentials;
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    credentials = {
      type: 'service_account',
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  } else if (process.env.GOOGLE_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
  } else if (process.env.GOOGLE_CREDENTIALS_PATH) {
    credentials = JSON.parse(
      readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, 'utf8'),
    );
  } else {
    throw new Error(
      'No Google credentials. Set GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY (preferred), GOOGLE_CREDENTIALS_JSON, or GOOGLE_CREDENTIALS_PATH.',
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _authClient = await auth.getClient();
  return _authClient;
}

async function sheetsApi() {
  if (_sheetsClient) return _sheetsClient;
  const auth = await getAuthClient();
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

function spreadsheetId() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error('SHEET_ID env var is not set.');
  return id;
}

// ---------------------------------------------------------------------------
// Header-aware row helpers
// ---------------------------------------------------------------------------

// Read all rows of a tab as [{header: value, _rowIndex: 2}, ...]
// _rowIndex is 1-based and points to the actual sheet row (data row 1 → sheet row 2).
export async function readRows(sheetName) {
  const sheets = await sheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = res.data.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };
  const [rawHeaders, ...data] = values;
  const headers = rawHeaders.map((h) => String(h ?? '').trim());
  const rows = data.map((row, i) => {
    const obj = { _rowIndex: i + 2 };
    headers.forEach((h, j) => {
      obj[h] = row[j] ?? '';
    });
    return obj;
  });
  return { headers, rows };
}

// Append a row using the sheet's existing header order.
// Missing keys become empty cells.
export async function appendRow(sheetName, obj) {
  const { headers } = await readRows(sheetName);
  if (headers.length === 0) {
    throw new Error(`Sheet "${sheetName}" has no header row.`);
  }
  const row = headers.map((h) => (obj[h] ?? ''));
  const sheets = await sheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: sheetName,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

// Update specific cells on a given row (1-based sheet row index).
// partialObj is {header: value, ...} — only listed headers are written.
export async function updateRow(sheetName, rowIndex, partialObj) {
  const { headers } = await readRows(sheetName);
  const data = [];
  for (const [key, value] of Object.entries(partialObj)) {
    const col = headers.indexOf(key);
    if (col < 0) continue;
    const colLetter = columnLetter(col);
    data.push({
      range: `${sheetName}!${colLetter}${rowIndex}`,
      values: [[value]],
    });
  }
  if (data.length === 0) return;
  const sheets = await sheetsApi();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: { valueInputOption: 'RAW', data },
  });
}

function columnLetter(zeroBasedIndex) {
  let n = zeroBasedIndex + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
