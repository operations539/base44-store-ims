import { useEffect, useMemo, useState } from 'react';

/* ============================ icons ============================ */
const P = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  box: <><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z" /><path d="M3 8.5 12 14l9-5.5" /><path d="M12 14v7" /></>,
  tag: <><path d="M20.6 13.6 13 21.2a2 2 0 0 1-2.8 0l-7.4-7.4a2 2 0 0 1-.6-1.4V4.6A1.6 1.6 0 0 1 3.8 3h7.8a2 2 0 0 1 1.4.6l7.6 7.6a2 2 0 0 1 0 2.4Z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.6" /></>,
  building: <><path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15" /><path d="M14 10h4a2 2 0 0 1 2 2v9" /><path d="M2 21h20" /><path d="M8 8h2M8 12h2M8 16h2" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.5a3 3 0 0 1 0 5.6" /><path d="M17.5 20a6 6 0 0 0-2-4.4" /></>,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3" /></>,
  download: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.8l1.2-1.8h6l1.2 1.8h1.8A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" /><circle cx="12" cy="13" r="3.2" /></>,
  return: <><path d="M4 9h11a4.5 4.5 0 0 1 0 9H8" /><path d="m8 5-4 4 4 4" /></>,
  truck: <><path d="M3 7h10v9H3z" /><path d="M13 10h4l3 3v3h-7z" /><circle cx="7" cy="18.5" r="1.6" /><circle cx="17" cy="18.5" r="1.6" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></>,
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10.5 20a2 2 0 0 0 3 0" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h9" /></>,
  dots: <><circle cx="5" cy="5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" /><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /><circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7" /></>,
  alert: <><path d="M12 4 2.8 20h18.4L12 4Z" /><path d="M12 10v4.5" /><path d="M12 17.6h.01" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  edit: <><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m14.5 5.5 4 4" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  eye: <><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" /></>,
  chevron: <><path d="m9 6 6 6-6 6" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v5h-5" /></>,
};

export function Icon({ name, size = 18, strokeWidth = 1.8, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {P[name] || P.grid}
    </svg>
  );
}

/* ============================ formatting ============================ */
const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export const inr = (v) => (v === null || v === undefined || v === '' ? '—' : `₹${inrFmt.format(Number(v))}`);
export const qty = (v) => (v === null || v === undefined || v === '' ? '—' : qtyFmt.format(Number(v)));

export function fmtDate(value) {
  if (!value) return '—';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/* ============================ primitives ============================ */
export function Badge({ tone = 'neutral', children, dot = false }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES = {
  Active: 'green',
  Closed: 'neutral',
  Inactive: 'neutral',
  Pending: 'amber',
  Approved: 'blue',
  Partial: 'amber',
  Fulfilled: 'green',
  Rejected: 'red',
  Issued: 'blue',
  'Delivered-Signed': 'green',
  'Return Raised': 'amber',
  'Pickup Assigned': 'blue',
  'Picked Up': 'blue',
  'Store Received': 'amber',
  'Pending Approval': 'amber',
  Sent: 'blue',
  Received: 'green',
  High: 'red',
  Urgent: 'red',
  Normal: 'neutral',
  Low: 'neutral',
  'High Side': 'navy',
  'Low Side': 'blue',
};

export function StatusBadge({ value }) {
  if (!value) return <span className="faint">—</span>;
  return <Badge tone={STATUS_TONES[value] || 'neutral'}>{value}</Badge>;
}

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'card-body' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          {actions ? <div className="actions">{actions}</div> : null}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon = 'box', title, description, action }) {
  return (
    <div className="empty">
      <div className="icon-wrap">
        <Icon name={icon} size={22} />
      </div>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label ? <label>{label}</label> : null}
      {children}
      {error ? <span className="field-error">{error}</span> : null}
      {hint && !error ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="center-page">
      <div style={{ display: 'grid', placeItems: 'center', gap: 10 }}>
        <div className="spinner" />
        {label ? <span className="muted small">{label}</span> : null}
      </div>
    </div>
  );
}

export function ErrorNote({ message }) {
  if (!message) return null;
  return <div className="toast-error">{message}</div>;
}

/* ============================ data table ============================ */
function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataTable({
  columns,
  rows,
  searchKeys,
  exportName = 'export',
  empty,
  toolbar,
  initialSort = { key: null, dir: 'asc' },
  rowKey = (r, i) => r.id || i,
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [hidden, setHidden] = useState(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)));
  const [menuOpen, setMenuOpen] = useState(false);

  const keys = searchKeys || columns.filter((c) => c.searchable !== false).map((c) => c.key);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) =>
      keys.some((k) => {
        const v = row[k];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      })
    );
  }, [rows, query, keys]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sort]);

  const visible = columns.filter((c) => !hidden.has(c.key));

  const onExport = () => {
    const headers = visible.map((c) => c.label);
    const data = sorted.map((row) =>
      visible.map((c) => (c.csv ? c.csv(row) : row[c.key] === null || row[c.key] === undefined ? '' : row[c.key]))
    );
    downloadCsv(`${exportName}.csv`, headers, data);
  };

  const toggleSort = (col) => {
    if (col.sortable === false) return;
    setSort((s) =>
      s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' }
    );
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <div className="table-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all columns…"
            aria-label="Search table"
          />
          {query ? (
            <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>
        {toolbar}
        <span className="table-meta">
          {sorted.length} of {rows.length}
        </span>
        <div className="column-menu">
          <button type="button" className="btn btn-sm" onClick={() => setMenuOpen((v) => !v)}>
            <Icon name="list" size={15} /> Columns
          </button>
          {menuOpen ? (
            <div className="popover">
              {columns.map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      })
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="btn btn-sm" onClick={onExport}>
          <Icon name="download" size={15} /> CSV
        </button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'num' : ''} ${c.sortable === false ? '' : 'sortable'}`}
                  onClick={() => toggleSort(c)}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {visible.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                    {c.render ? c.render(row) : row[c.key] === null || row[c.key] === undefined || row[c.key] === '' ? <span className="faint">—</span> : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!sorted.length ? (
        empty || <EmptyState title="Nothing to show" description="Try a different search or filter." />
      ) : null}
    </div>
  );
}
