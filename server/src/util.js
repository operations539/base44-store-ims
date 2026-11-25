export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const bad = (msg, fields) => new HttpError(400, msg, fields);
export const denied = (msg = 'You do not have access to this action.') => new HttpError(403, msg);
export const notFound = (msg = 'Record not found.') => new HttpError(404, msg);

/** Wrap async route handlers so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const trim = (v) => (typeof v === 'string' ? v.trim() : v);

export function str(value, { max = 500 } = {}) {
  const v = trim(value);
  if (v === undefined || v === null || v === '') return null;
  return String(v).slice(0, max);
}

export function requiredStr(value, field, { max = 500 } = {}) {
  const v = str(value, { max });
  if (!v) throw bad(`${field} is required.`, { [field]: 'Required' });
  return v;
}

export function num(value, { field = 'Value', min = null, max = null, def = null } = {}) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number.`, { [field]: 'Must be a number' });
  if (min !== null && n < min) throw bad(`${field} must be at least ${min}.`, { [field]: `Minimum ${min}` });
  if (max !== null && n > max) throw bad(`${field} must be at most ${max}.`, { [field]: `Maximum ${max}` });
  return n;
}

export function bool(value, def = false) {
  if (value === undefined || value === null || value === '') return def;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

export const UNITS = ['nos', 'pcs', 'feet', 'mtr', 'sqft', 'kg', 'roll', 'box'];
export const TAX_SLABS = [0, 5, 12, 18, 28];
export const DEPARTMENTS = ['SLS', 'DSN', 'PRJ', 'STR', 'SRV', 'ACC', 'HR'];

/** Normalise an Indian mobile number to +91XXXXXXXXXX (10-digit, starts 6-9). */
export function normalizePhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91${ten}`;
}

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(value) {
  if (!value) return null;
  const v = String(value).toUpperCase().replace(/\s+/g, '');
  return GSTIN_RE.test(v) ? v : null;
}

export function isValidDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function dateOr(value, def = null) {
  if (value === undefined || value === null || value === '') return def;
  if (!isValidDate(value)) throw bad('Date must be in YYYY-MM-DD format.', { date: 'Use YYYY-MM-DD' });
  return value;
}

/** IST calendar parts for a given instant. */
export function istParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Indian financial year label for a YYYY-MM-DD string (April–March). */
export function financialYear(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Minimal RFC4180 CSV parser (handles quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);

  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((cells) => {
    const rec = {};
    headers.forEach((h, idx) => {
      rec[h] = (cells[idx] ?? '').trim();
    });
    return rec;
  });
  return { headers, records };
}

export function toCsv(headers, records) {
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const rec of records) lines.push(headers.map((h) => esc(rec[h])).join(','));
  return lines.join('\r\n');
}
