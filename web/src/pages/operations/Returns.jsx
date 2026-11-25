import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import {
  Badge, Card, DataTable, EmptyState, Field, Icon, Modal, Spinner, StatusBadge, fmtDate, fmtDateTime, qty,
} from '../../ui.jsx';
import Tip from '../../components/Tip.jsx';

const OPEN_STATUSES = ['Return Raised', 'Pickup Assigned', 'Picked Up', 'Store Received'];
const TRANSPORT_MODES = ['Internal EECO', 'Third-Party Porter', 'Vendor Direct', 'Field Staff'];

async function uploadImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const { url } = await post('/files', { data_url: dataUrl });
  return url;
}

function StageTrack({ row }) {
  const stages = [
    ['return_raised_at', 'Raised'],
    ['pickup_assigned_at', 'Pickup'],
    ['picked_up_at', 'Picked up'],
    ['store_received_at', 'Received'],
    ['system_posted_at', 'Posted'],
  ];
  const done = stages.filter(([k]) => row[k]).length;
  return (
    <>
      <div className="stage-track" aria-label={`Stage ${done} of 5`}>
        {stages.map(([k]) => (
          <span key={k} className={`stage ${row[k] ? 'done' : ''}`} />
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        Stage {done}/5
        {row.pickup_assigned_at ? ` · pickup ${fmtDateTime(row.pickup_assigned_at)}` : ''}
        {row.system_posted_at ? ` · posted ${fmtDateTime(row.system_posted_at)}` : ''}
      </div>
    </>
  );
}

export default function Returns() {
  const { has } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('open');
  const [pickupFor, setPickupFor] = useState(null);
  const [inspectFor, setInspectFor] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get('/returns')
      .then((d) => setRows(d.returns))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    if (filter === 'open') return rows.filter((r) => OPEN_STATUSES.includes(r.status));
    if (filter === 'closed') return rows.filter((r) => r.status === 'Closed');
    return rows;
  }, [rows, filter]);

  const act = async (fn, message) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'challan_code', label: 'Return', render: (r) => <strong>{r.challan_code}</strong> },
    { key: 'challan_date', label: 'Date', render: (r) => fmtDate(r.challan_date), csv: (r) => fmtDate(r.challan_date) },
    { key: 'site_project_id', label: 'Site', render: (r) => r.site_project_id || r.vendor_name || '—' },
    { key: 'flow_type', label: 'Flow' },
    { key: 'status', label: 'Stage', render: (r) => <StatusBadge value={r.status} />, csv: (r) => r.status },
    { key: 'sent_qty', label: 'Sent', align: 'right', render: (r) => qty(r.sent_qty), csv: (r) => r.sent_qty },
    { key: 'line_count', label: 'Lines', align: 'right' },
    {
      key: 'hours_open',
      label: 'Hrs open',
      align: 'right',
      render: (r) => (Number(r.hours_open) > 48 && r.status !== 'Closed' ? <strong style={{ color: 'var(--red)' }}>{r.hours_open}</strong> : r.hours_open),
    },
    {
      key: 'flags',
      label: 'Flags',
      render: (r) => (
        <>
          {r.short_missing_flagged ? <Badge tone="red">Short / missing</Badge> : null}
          {r.sla_48h_breach_flag && r.status !== 'Closed' ? <Badge tone="red">48h SLA</Badge> : null}
          {r.signed_return_dc_photo_url ? <Badge tone="green">Signed DC</Badge> : null}
        </>
      ),
      csv: (r) => [r.short_missing_flagged ? 'Short/missing' : '', r.signed_return_dc_photo_url ? 'Signed DC' : ''].filter(Boolean).join(' / '),
    },
    {
      key: 'actions',
      label: 'Next step',
      sortable: false,
      render: (r) => {
        if (r.status === 'Return Raised' && has('returns.pickup')) {
          return (
            <button type="button" className="btn btn-sm" onClick={() => setPickupFor(r)}>
              <Icon name="truck" size={14} /> Assign pickup
            </button>
          );
        }
        if (r.status === 'Pickup Assigned') {
          return (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => act(() => post(`/returns/${r.id}/handover`, {}), `${r.challan_code}: material handed over.`)}
            >
              <Icon name="check" size={14} /> Handed over
            </button>
          );
        }
        if (r.status === 'Picked Up' && has('returns.receive')) {
          return (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => act(() => post(`/returns/${r.id}/receive`, {}), `${r.challan_code}: received at store.`)}
            >
              <Icon name="box" size={14} /> Received at store
            </button>
          );
        }
        if (r.status === 'Store Received' && has('returns.post')) {
          return (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setInspectFor(r.id)}>
              <Icon name="eye" size={14} /> Inspect &amp; post
            </button>
          );
        }
        return <span className="faint">—</span>;
      },
    },
  ];

  if (!rows && !error) return <Spinner label="Loading returns…" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Material returns</h1>
          <p>
            Five-stage anti-leakage gate — raised, picked up, received and posted with usable / scrap / short reconciliation
            <Tip text="Usable vs. Scrap Gate: usable quantity returns to store stock and the site ledger; scrap only increases the scrap bucket; short/missing needs remarks and raises a red flag." />
          </p>
        </div>
        <div className="actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter returns">
            <option value="open">Open returns</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <button type="button" className="btn" onClick={load}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      <Card
        title="Return register"
        subtitle="Nothing is deleted — every return keeps its five stage timestamps"
      >
        <DataTable
          columns={columns}
          rows={visible}
          exportName="material-returns"
          rowKey={(r) => r.id}
          empty={<EmptyState icon="return" title="No returns here" description="Returns raised from site appear the moment a supervisor submits them." />}
        />
      </Card>

      {pickupFor ? (
        <PickupModal
          row={pickupFor}
          onClose={() => setPickupFor(null)}
          onSaved={(msg) => {
            setPickupFor(null);
            setNotice(msg);
            load();
          }}
        />
      ) : null}

      {inspectFor ? (
        <InspectModal
          id={inspectFor}
          onClose={() => setInspectFor(null)}
          onSaved={(msg) => {
            setInspectFor(null);
            setNotice(msg);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function PickupModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    transport_mode: 'Internal EECO',
    driver_delivery_person_name: row.driver_delivery_person_name || '',
    driver_phone: row.driver_phone || '',
    vehicle_no: row.vehicle_no || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      title="Assign pickup"
      subtitle={`${row.challan_code} · ${row.site_project_id || row.vendor_name || ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await post(`/returns/${row.id}/pickup`, form);
                onSaved(`${row.challan_code}: pickup assigned.`);
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Assign pickup
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-red">{error}</div> : null}
      <div className="form-grid">
        <Field label="Transport mode">
          <select value={form.transport_mode} onChange={set('transport_mode')}>
            {TRANSPORT_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Driver / delivery person">
          <input value={form.driver_delivery_person_name} onChange={set('driver_delivery_person_name')} placeholder="Name" />
        </Field>
        <Field label="Driver phone">
          <input value={form.driver_phone} onChange={set('driver_phone')} placeholder="+91…" />
        </Field>
        <Field label="Vehicle number">
          <input value={form.vehicle_no} onChange={set('vehicle_no')} placeholder="MH-12-AB-1234" />
        </Field>
      </div>
      <p className="small muted">No separate driver login — the driver details travel with the return.</p>
    </Modal>
  );
}

function InspectModal({ id, onClose, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [lines, setLines] = useState([]);
  const [delayReason, setDelayReason] = useState('');
  const [signedDc, setSignedDc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get(`/returns/${id}`)
      .then((d) => {
        setDetail(d.return);
        setDelayReason(d.return.delay_reason || '');
        setSignedDc(d.return.signed_return_dc_photo_url || '');
        setLines(
          (d.return.lines || []).map((l) => ({
            id: l.id,
            item_name: l.item_name,
            item_code: l.item_code,
            unit: l.unit,
            qty: Number(l.qty),
            usable: Number(l.qty),
            scrap: 0,
            short: 0,
            remarks: '',
          }))
        );
      })
      .catch((err) => setError(err.message));
  }, [id]);

  if (!detail) return <Modal title="Inspect return" onClose={onClose}>{error ? <div className="alert alert-red">{error}</div> : <Spinner label="Loading lines…" />}</Modal>;

  const overdue = Number(detail.hours_open) > 48;
  const isVendorReturn = detail.flow_type === 'Return Vendor';

  const setLine = (lineId, key, value) =>
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, [key]: value } : l)));

  const reconcile = (l) => Math.abs(Number(l.usable) + Number(l.scrap) + Number(l.short) - l.qty) < 0.0005;

  const submit = async () => {
    setError('');
    const bad = lines.find((l) => !reconcile(l));
    if (bad) {
      setError(`${bad.item_code}: usable + scrap + short must equal ${bad.qty} ${bad.unit}.`);
      return;
    }
    if (overdue && !delayReason.trim()) {
      setError('This return is past 48 hours — record the delay reason.');
      return;
    }
    if (isVendorReturn && !signedDc) {
      setError('Upload the signed return DC before closing a vendor return.');
      return;
    }
    setBusy(true);
    try {
      await post(`/returns/${id}/post`, {
        delay_reason: delayReason,
        signed_return_dc_photo_url: signedDc || undefined,
        lines: lines.map((l) => ({ id: l.id, usable: l.usable, scrap: l.scrap, short: l.short, remarks: l.remarks })),
      });
      onSaved(`${detail.challan_code}: posted and closed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="Inspect & post return"
      subtitle={`${detail.challan_code} · ${detail.site_project_id || detail.vendor_name || ''} · ${detail.status}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            <Icon name="check" size={15} /> Post &amp; close
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-red">{error}</div> : null}
      {overdue ? (
        <div className="alert alert-amber">
          <Icon name="alert" size={15} />
          <div>Open {detail.hours_open} hours — a delay reason is mandatory before posting.</div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="data inspect-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Sent</th>
              <th>Usable</th>
              <th>Scrap</th>
              <th>Short / missing</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.item_name}
                  <div className="faint small">{l.item_code}</div>
                </td>
                <td className="num">{qty(l.qty)} {l.unit}</td>
                <td><input type="number" min="0" step="0.001" value={l.usable} onChange={(e) => setLine(l.id, 'usable', e.target.value)} /></td>
                <td><input type="number" min="0" step="0.001" value={l.scrap} onChange={(e) => setLine(l.id, 'scrap', e.target.value)} /></td>
                <td><input type="number" min="0" step="0.001" value={l.short} onChange={(e) => setLine(l.id, 'short', e.target.value)} /></td>
                <td>
                  <input
                    className="inspect-note"
                    value={l.remarks}
                    onChange={(e) => setLine(l.id, 'remarks', e.target.value)}
                    placeholder={Number(l.scrap) > 0 || Number(l.short) > 0 ? 'Mandatory remarks' : 'Optional'}
                  />
                  {!reconcile(l) ? <div className="reconcile-flag">Does not reconcile</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="form-grid" style={{ marginTop: 14 }}>
        <Field label={overdue ? 'Delay reason (mandatory)' : 'Delay reason'}>
          <input value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Why the return took more than 48 hours" />
        </Field>
        {isVendorReturn ? (
          <Field label="Signed return DC (mandatory for vendor returns)">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setSignedDc(await uploadImage(file));
                } catch (err) {
                  setError(err.message);
                }
              }}
            />
            {signedDc ? <span className="hint">Uploaded ✓</span> : null}
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
