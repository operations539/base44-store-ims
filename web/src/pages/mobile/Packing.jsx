import { useEffect, useState } from 'react';
import { get } from '../../api.js';
import { Badge, EmptyState, Icon, Spinner, StatusBadge, fmtDate, qty } from '../../ui.jsx';

export default function Packing() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    get('/mobile/packing')
      .then((d) => setRows(d.challans))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!rows) return <Spinner label="Loading packing lists…" />;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 17 }}>Approved packing lists</h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Price-free. Tap a card to see the items to load.
        </p>
      </div>

      {!rows.length ? (
        <EmptyState
          icon="list"
          title="No packing lists right now"
          description="Approved challans waiting to leave the store will appear here."
        />
      ) : null}

      {rows.map((c) => {
        const expanded = open === c.id;
        return (
          <div className="mobile-card" key={c.id}>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <h3>{c.site_project_id}</h3>
                <div className="code">{c.challan_code}</div>
              </div>
              <span className="spacer" />
              <StatusBadge value={c.status} />
            </div>

            <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
              <Badge tone="neutral">{c.flow_type}</Badge>
              <Badge tone={c.signed_dc_photo_url ? 'green' : 'amber'}>
                {c.signed_dc_photo_url ? 'Signed copy in' : 'Signed copy pending'}
              </Badge>
              {c.sla_48h_breach_flag && !c.signed_dc_photo_url ? <Badge tone="red">48h breach</Badge> : null}
            </div>

            <div className="small muted" style={{ marginTop: 8 }}>
              {c.client_project_name} · {fmtDate(c.challan_date)} · {c.line_count} line
              {c.line_count === 1 ? '' : 's'}
              {c.driver_delivery_person_name ? ` · ${c.driver_delivery_person_name}` : ''}
            </div>

            <button
              type="button"
              className="btn btn-sm btn-block"
              style={{ marginTop: 10 }}
              onClick={() => setOpen(expanded ? null : c.id)}
            >
              <Icon name={expanded ? 'chevron' : 'list'} size={14} />
              {expanded ? 'Hide items' : `View ${c.line_count} item${c.line_count === 1 ? '' : 's'}`}
            </button>

            {expanded ? (
              <div className="mobile-lines">
                {c.lines.map((l) => (
                  <div className="mobile-line" key={`${c.id}-${l.line_no}`}>
                    <span>
                      {l.item_name}
                      <span className="faint"> · {l.item_code}</span>
                      {l.serial_nos?.length ? (
                        <span className="faint" style={{ display: 'block', fontSize: 11 }}>
                          Serials: {l.serial_nos.join(', ')}
                        </span>
                      ) : null}
                    </span>
                    <span className="qty">
                      {qty(l.qty)} {l.unit}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
