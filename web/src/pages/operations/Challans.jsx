import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post } from '../../api.js';
import {
  Badge,
  DataTable,
  EmptyState,
  Field,
  Icon,
  Modal,
  Spinner,
  StatusBadge,
  fmtDate,
  qty,
} from '../../ui.jsx';
import { DcDocument, PrintOverlay } from '../../print.jsx';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

const FLOWS = [
  { value: 'Full Store', label: 'Full Store — deduct store stock' },
  { value: 'Split', label: 'Split dispatch — store + vendor on one DC' },
  { value: 'Direct Vendor', label: 'Direct-to-Site — vendor supplies, store untouched' },
];

const TRANSPORT = ['Internal EECO', 'Third-Party Porter', 'Vendor Direct', 'Field Staff'];

const blankLine = () => ({ item_id: '', qty: '', line_source: 'Store', serials: '' });

function flowLabel(flow) {
  return flow === 'Direct Vendor' ? 'Direct-to-Site' : flow;
}

export default function Challans() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [printDoc, setPrintDoc] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState([]);
  const [flowFilter, setFlowFilter] = useState('');
  const [form, setForm] = useState({
    flow_type: 'Full Store',
    site_id: '',
    linked_mrn_id: '',
    linked_po_id: '',
    challan_date: todayIso(),
    transport_mode: 'Internal EECO',
    driver_delivery_person_name: '',
    driver_phone: '',
    vehicle_no: '',
    vendor_physical_dc_no: '',
    header_remarks: '',
    lines: [blankLine()],
  });

  const loadList = () => get('/challans').then(setData).catch((err) => setError(err.message));

  useEffect(() => {
    Promise.all([get('/challans'), get('/sites'), get('/items'), get('/mrn'), get('/pos')])
      .then(([challanData, siteData, itemData, mrnData, poData]) => {
        setData(challanData);
        setOptions({
          sites: siteData.sites,
          items: itemData.items,
          mrns: mrnData.mrns.filter((m) => ['Approved', 'Partial'].includes(m.status)),
          pos: poData.pos.filter((p) => ['Issued', 'Sent'].includes(p.status)),
        });
      })
      .catch((err) => setError(err.message));
  }, []);

  const openDetail = async (id) => {
    try {
      const result = await get(`/challans/${id}`);
      setDetail(result.challan);
    } catch (err) {
      setError(err.message);
    }
  };

  const applyMrn = async (mrnId) => {
    if (!mrnId) {
      setForm((prev) => ({ ...prev, linked_mrn_id: '', linked_po_id: '' }));
      return;
    }
    const result = await get(`/mrn/${mrnId}`);
    const flow =
      result.mrn.routing_type === 'Direct-to-Site'
        ? 'Direct Vendor'
        : result.mrn.routing_type === 'Split'
        ? 'Split'
        : 'Full Store';
    const lines = (result.mrn.lines || [])
      .filter((line) => Number(line.remaining_qty) > 0)
      .map((line) => ({
        item_id: line.item_id,
        qty: String(line.remaining_qty),
        line_source: flow === 'Direct Vendor' ? 'Vendor' : 'Store',
        serials: '',
      }));
    setForm((prev) => ({
      ...prev,
      linked_mrn_id: mrnId,
      site_id: result.mrn.site_id,
      flow_type: flow,
      lines: lines.length ? lines : [blankLine()],
    }));
  };

  // Prefill from ?mrn=<id>
  useEffect(() => {
    const mrnId = params.get('mrn');
    if (!mrnId || !options || modalOpen) return;
    applyMrn(mrnId)
      .then(() => {
        setModalOpen(true);
        setParams({}, { replace: true });
      })
      .catch(() => setParams({}, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const setFlow = (flow) => {
    setForm((prev) => ({
      ...prev,
      flow_type: flow,
      lines: prev.lines.map((line) => ({
        ...line,
        line_source: flow === 'Full Store' ? 'Store' : flow === 'Direct Vendor' ? 'Vendor' : line.line_source,
      })),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const result = await post('/challans', {
        flow_type: form.flow_type,
        site_id: form.site_id,
        linked_mrn_id: form.linked_mrn_id || null,
        linked_po_id: form.linked_po_id || null,
        challan_date: form.challan_date,
        transport_mode: form.transport_mode,
        driver_delivery_person_name: form.driver_delivery_person_name,
        driver_phone: form.driver_phone,
        vehicle_no: form.vehicle_no,
        vendor_physical_dc_no: form.vendor_physical_dc_no,
        header_remarks: form.header_remarks,
        lines: form.lines.map((line) => ({
          item_id: line.item_id,
          qty: line.qty,
          line_source: line.line_source,
          serial_nos: line.serials
            ? line.serials.split(',').map((s) => s.trim()).filter(Boolean)
            : [],
        })),
      });
      setModalOpen(false);
      setWarning(result.negative_items || []);
      setForm((prev) => ({ ...prev, lines: [blankLine()], header_remarks: '' }));
      await loadList();
      openDetail(result.id);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'challan_code',
        label: 'Challan',
        render: (r) => (
          <button type="button" className="link-btn mono" onClick={() => openDetail(r.id)}>
            {r.challan_code}
          </button>
        ),
      },
      { key: 'challan_date', label: 'Date', render: (r) => fmtDate(r.challan_date) },
      { key: 'site_project_id', label: 'Site', render: (r) => r.site_project_id || '—' },
      { key: 'flow_type', label: 'Flow', render: (r) => <Badge tone="neutral">{flowLabel(r.flow_type)}</Badge> },
      { key: 'mrn_no', label: 'MRN', render: (r) => r.mrn_no || <span className="faint">Direct</span> },
      { key: 'po_code', label: 'PO', render: (r) => r.po_code || <span className="faint">—</span> },
      { key: 'line_count', label: 'Lines', align: 'right' },
      { key: 'total_qty', label: 'Qty', align: 'right', render: (r) => qty(r.total_qty) },
      {
        key: 'flags',
        label: 'Flags',
        sortable: false,
        searchable: false,
        render: (r) => (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {r.override_minus_stock_flag ? <Badge tone="amber">Minus stock</Badge> : null}
            {r.backdated_flag ? <Badge tone="neutral">Backdated</Badge> : null}
            <Badge tone={r.signed_dc_photo_url ? 'green' : 'amber'}>
              {r.signed_dc_photo_url ? 'Signed' : 'Signed pending'}
            </Badge>
          </div>
        ),
      },
      { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
      {
        key: 'open',
        label: '',
        sortable: false,
        searchable: false,
        render: (r) => (
          <button type="button" className="btn btn-sm" onClick={() => openDetail(r.id)}>
            Open <Icon name="chevron" size={13} />
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  if (error && !data) return <div className="page"><div className="alert alert-red">{error}</div></div>;
  if (!data || !options) return <Spinner label="Loading challans…" />;

  const rows = flowFilter ? data.challans.filter((c) => c.flow_type === flowFilter) : data.challans;
  const needsVendorPo =
    form.flow_type === 'Direct Vendor' || form.lines.some((line) => line.line_source === 'Vendor');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dispatch challans</h1>
          <p>
            One unified challan for all three flows. Store stock moves only for store lines; every line lands in the
            site ledger. Zero stock never blocks an urgent dispatch.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={15} /> New challan
          </button>
        </div>
      </div>

      {warning.length ? (
        <div className="alert alert-amber" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={16} />
          <div>
            <strong>Dispatched with negative store balance.</strong> {warning.length} item(s) went below zero and an
            override was written to the audit log:{' '}
            {warning.map((w) => `${w.item_code} (${qty(w.store_physical_stock)} ${w.unit})`).join(', ')}.
          </div>
        </div>
      ) : null}

      <div className="filter-bar">
        <select className="select" style={{ maxWidth: 280 }} value={flowFilter} onChange={(e) => setFlowFilter(e.target.value)}>
          <option value="">Every dispatch flow</option>
          {FLOWS.map((flow) => (
            <option key={flow.value} value={flow.value}>
              {flowLabel(flow.value)}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="chip"><Icon name="truck" size={14} /> {rows.length} challans</span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        exportName="dispatch-challans"
        initialSort={{ key: 'challan_date', dir: 'desc' }}
        empty={
          <EmptyState
            icon="truck"
            title="No challans yet"
            description="Create a challan from an approved MRN or issue an urgent direct challan."
          />
        }
      />

      {modalOpen ? (
        <Modal
          wide
          title="New dispatch challan"
          subtitle="Auto DC number · backdated flag · rate-free"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="dc-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Issuing…' : 'Issue challan'}
              </button>
            </>
          }
        >
          <form id="dc-form" onSubmit={submit}>
            {formError ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{formError}</div> : null}

            <div className="form-grid">
              <Field label="Dispatch flow">
                <select className="select" value={form.flow_type} onChange={(e) => setFlow(e.target.value)}>
                  {FLOWS.map((flow) => (
                    <option key={flow.value} value={flow.value}>
                      {flow.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Site">
                <select
                  className="select"
                  value={form.site_id}
                  onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                  required
                >
                  <option value="">Select a site…</option>
                  {options.sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_project_id} — {site.client_project_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Linked MRN" hint="Optional — leave blank for an urgent direct challan.">
                <select
                  className="select"
                  value={form.linked_mrn_id}
                  onChange={(e) => applyMrn(e.target.value).catch((err) => setFormError(err.message))}
                >
                  <option value="">No linked MRN</option>
                  {options.mrns.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.mrn_no} · {m.site_project_id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Linked Direct PO" hint={needsVendorPo ? 'Required for vendor-sourced lines.' : 'Optional'}>
                <select
                  className="select"
                  value={form.linked_po_id}
                  onChange={(e) => setForm({ ...form, linked_po_id: e.target.value })}
                  required={needsVendorPo}
                >
                  <option value="">No linked PO</option>
                  {options.pos.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.po_code} · {po.vendor_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Challan date">
                <input
                  type="date"
                  className="input"
                  value={form.challan_date}
                  onChange={(e) => setForm({ ...form, challan_date: e.target.value })}
                />
              </Field>
              <Field label="Transport mode">
                <select
                  className="select"
                  value={form.transport_mode}
                  onChange={(e) => setForm({ ...form, transport_mode: e.target.value })}
                >
                  {TRANSPORT.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Driver / delivery person">
                <input
                  className="input"
                  value={form.driver_delivery_person_name}
                  onChange={(e) => setForm({ ...form, driver_delivery_person_name: e.target.value })}
                  placeholder="Name"
                />
              </Field>
              <Field label="Driver phone">
                <input
                  className="input"
                  value={form.driver_phone}
                  onChange={(e) => setForm({ ...form, driver_phone: e.target.value })}
                  placeholder="10-digit mobile"
                />
              </Field>
              <Field label="Vehicle no">
                <input
                  className="input"
                  value={form.vehicle_no}
                  onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })}
                  placeholder="MH 01 AB 1234"
                />
              </Field>
              <Field label="Vendor physical DC no" hint="Optional — for vendor-direct movement.">
                <input
                  className="input"
                  value={form.vendor_physical_dc_no}
                  onChange={(e) => setForm({ ...form, vendor_physical_dc_no: e.target.value })}
                />
              </Field>
              <Field label="Remarks" className="full">
                <textarea
                  className="textarea"
                  rows={2}
                  value={form.header_remarks}
                  onChange={(e) => setForm({ ...form, header_remarks: e.target.value })}
                />
              </Field>
            </div>

            <div className="line-list">
              <div className="line-head">
                <strong>Items on this challan</strong>
                <span className="faint small">Rate, invoice and expiry are never printed on a DC.</span>
              </div>
              {form.lines.map((line, index) => {
                const item = options.items.find((i) => i.id === line.item_id);
                const stock = Number(item?.store_physical_stock ?? 0);
                const short = line.line_source === 'Store' && Number(line.qty) > stock;
                return (
                  <div className="line-row line-row-dc" key={index}>
                    <select
                      className="select"
                      value={line.item_id}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          lines: prev.lines.map((l, i) => (i === index ? { ...l, item_id: e.target.value } : l)),
                        }))
                      }
                      required
                      aria-label={`Item ${index + 1}`}
                    >
                      <option value="">Select item…</option>
                      {options.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.item_code} · {i.item_name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      className={`input ${short ? 'has-error' : ''}`}
                      placeholder="Qty"
                      value={line.qty}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          lines: prev.lines.map((l, i) => (i === index ? { ...l, qty: e.target.value } : l)),
                        }))
                      }
                      required
                      aria-label={`Quantity ${index + 1}`}
                    />
                    <span className="line-unit">{item?.unit || 'UOM'}</span>
                    {form.flow_type === 'Split' ? (
                      <select
                        className="select"
                        value={line.line_source}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            lines: prev.lines.map((l, i) =>
                              i === index ? { ...l, line_source: e.target.value } : l
                            ),
                          }))
                        }
                        aria-label={`Source ${index + 1}`}
                      >
                        <option value="Store">Store</option>
                        <option value="Vendor">Vendor</option>
                      </select>
                    ) : (
                      <span className="line-source">{line.line_source}</span>
                    )}
                    <input
                      className="input"
                      placeholder="Serial nos (comma separated)"
                      value={line.serials}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          lines: prev.lines.map((l, i) => (i === index ? { ...l, serials: e.target.value } : l)),
                        }))
                      }
                      aria-label={`Serials ${index + 1}`}
                    />
                    <span className={`line-stock ${short ? 'warn-text' : ''}`} title="Live store stock">
                      {line.line_source === 'Store' ? `Stock ${qty(stock)}` : 'Vendor'}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          lines: prev.lines.length > 1 ? prev.lines.filter((_, i) => i !== index) : prev.lines,
                        }))
                      }
                      aria-label="Remove line"
                      disabled={form.lines.length === 1}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setForm((prev) => ({ ...prev, lines: [...prev.lines, blankLine()] }))}
              >
                <Icon name="plus" size={14} /> Add item
              </button>
              {form.lines.some((l) => l.line_source === 'Store' && Number(l.qty) > Number(options.items.find((i) => i.id === l.item_id)?.store_physical_stock ?? 0)) ? (
                <div className="alert alert-amber" style={{ marginTop: 10 }}>
                  <Icon name="alert" size={15} />
                  <div>
                    Some store lines exceed live stock. You can still issue — the balance goes negative and an audit
                    override is recorded.
                  </div>
                </div>
              ) : null}
            </div>
          </form>
        </Modal>
      ) : null}

      {detail ? (
        <Modal
          wide
          title={detail.challan_code}
          subtitle={`${detail.site_project_id} · ${fmtDate(detail.challan_date)}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPrintDoc(detail)}>
                <Icon name="file" size={15} /> Print 3-copy DC
              </button>
              <button type="button" className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </>
          }
        >
          <div className="meta-grid">
            <div>
              <span>Flow</span>
              <strong>{flowLabel(detail.flow_type)}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong><StatusBadge value={detail.status} /></strong>
            </div>
            <div>
              <span>Linked MRN</span>
              <strong>{detail.mrn_no || 'Direct challan'}</strong>
            </div>
            <div>
              <span>Linked PO</span>
              <strong>{detail.po_code || '—'}</strong>
            </div>
            <div>
              <span>Transport</span>
              <strong>{detail.transport_mode || '—'}</strong>
            </div>
            <div>
              <span>Driver / person</span>
              <strong>{detail.driver_delivery_person_name || '—'}</strong>
            </div>
            <div>
              <span>Vehicle</span>
              <strong>{detail.vehicle_no || '—'}</strong>
            </div>
            <div>
              <span>Vendor physical DC</span>
              <strong>{detail.vendor_physical_dc_no || '—'}</strong>
            </div>
          </div>

          {detail.override_minus_stock_flag ? (
            <div className="alert alert-amber" style={{ margin: '12px 0' }}>
              <Icon name="alert" size={15} />
              <div>Issued with a negative store balance — the override is in the audit log.</div>
            </div>
          ) : null}

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Source</th>
                  <th className="num">Qty</th>
                  <th>Serials</th>
                </tr>
              </thead>
              <tbody>
                {(detail.lines || []).map((line) => (
                  <tr key={line.id}>
                    <td>{line.line_no}</td>
                    <td>
                      <div>{line.item_name}</div>
                      <div className="small faint mono">{line.item_code}</div>
                    </td>
                    <td><Badge tone={line.line_source === 'Vendor' ? 'blue' : 'neutral'}>{line.line_source}</Badge></td>
                    <td className="num">{qty(line.qty)} {line.unit}</td>
                    <td className="small muted">
                      {Array.isArray(line.serial_nos) && line.serial_nos.length ? line.serial_nos.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail.header_remarks ? <p className="small muted" style={{ marginTop: 10 }}>{detail.header_remarks}</p> : null}
        </Modal>
      ) : null}

      {printDoc ? (
        <PrintOverlay title={`${printDoc.challan_code} · Delivery Challan`} onClose={() => setPrintDoc(null)}>
          <DcDocument challan={printDoc} />
        </PrintOverlay>
      ) : null}
    </div>
  );
}
