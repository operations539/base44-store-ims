import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import {
  DataTable,
  EmptyState,
  Field,
  Icon,
  Modal,
  Spinner,
  StatusBadge,
  fmtDate,
  fmtDateTime,
  inr,
  qty,
} from '../../ui.jsx';
import { PoDocument, PrintOverlay } from '../../print.jsx';

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const blankLine = () => ({ item_id: '', qty: '', unit_rate: '' });

function lineAmount(line) {
  return Number(line.qty || 0) * Number(line.unit_rate || 0);
}

function poValue(po) {
  return (po.line_items || []).reduce((sum, line) => sum + lineAmount(line), 0);
}

function waNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export default function Pos() {
  const { has } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [printPo, setPrintPo] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rates, setRates] = useState({});
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [form, setForm] = useState({
    vendor_id: '',
    po_date: todayIso(),
    delivery_location_type: 'Store',
    delivery_site_id: '',
    linked_mrn_id: '',
    approval_required: false,
    approver_ids: [],
    lines: [blankLine()],
  });

  const loadList = () => get('/pos').then(setData).catch((err) => setError(err.message));

  useEffect(() => {
    Promise.all([
      get('/pos'),
      get('/vendors'),
      get('/sites'),
      get('/items'),
      get('/pos/approvers'),
      get('/mrn'),
    ])
      .then(([posData, vendorData, siteData, itemData, approverData, mrnData]) => {
        setData(posData);
        setOptions({
          vendors: vendorData.vendors,
          sites: siteData.sites,
          items: itemData.items,
          pricingVisible: itemData.pricingVisible,
          approvers: approverData.approvers,
          mrns: mrnData.mrns,
        });
      })
      .catch((err) => setError(err.message));
  }, []);

  const openDetail = async (id) => {
    try {
      const result = await get(`/pos/${id}`);
      setDetail(result.po);
      const draft = {};
      (result.po.line_items || []).forEach((line) => {
        draft[line.item_id] = String(line.unit_rate ?? 0);
      });
      setRates(draft);
      setDecisionRemarks('');
    } catch (err) {
      setError(err.message);
    }
  };

  // Prefill from a linked MRN (?mrn=<id>)
  useEffect(() => {
    const mrnId = params.get('mrn');
    if (!mrnId || !options || modalOpen) return;
    get(`/mrn/${mrnId}`)
      .then((result) => {
        const lines = (result.mrn.lines || [])
          .filter((line) => Number(line.remaining_qty) > 0)
          .map((line) => {
            const item = options.items.find((i) => i.id === line.item_id);
            return {
              item_id: line.item_id,
              qty: String(line.remaining_qty),
              unit_rate: String(item?.latest_rate ?? ''),
            };
          });
        setForm((prev) => ({
          ...prev,
          linked_mrn_id: mrnId,
          delivery_location_type: 'Site',
          delivery_site_id: result.mrn.site_id,
          lines: lines.length ? lines : [blankLine()],
        }));
        setModalOpen(true);
        setParams({}, { replace: true });
      })
      .catch(() => setParams({}, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const approvers = options?.approvers || [];

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const result = await post('/pos', {
        vendor_id: form.vendor_id,
        po_date: form.po_date,
        delivery_location_type: form.delivery_location_type,
        delivery_site_id: form.delivery_location_type === 'Site' ? form.delivery_site_id : null,
        linked_mrn_id: form.linked_mrn_id || null,
        approval_required: form.approval_required,
        approver_ids: form.approval_required ? form.approver_ids : [],
        line_items: form.lines.map((line) => ({
          item_id: line.item_id,
          qty: line.qty,
          unit_rate: line.unit_rate === '' ? 0 : line.unit_rate,
        })),
      });
      setModalOpen(false);
      setForm({
        vendor_id: '',
        po_date: todayIso(),
        delivery_location_type: 'Store',
        delivery_site_id: '',
        linked_mrn_id: '',
        approval_required: false,
        approver_ids: [],
        lines: [blankLine()],
      });
      await loadList();
      openDetail(result.id);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveRates = async () => {
    if (!detail) return;
    setBusy(true);
    setFormError('');
    try {
      await patch(`/pos/${detail.id}`, {
        line_items: (detail.line_items || []).map((line) => ({
          item_id: line.item_id,
          unit_rate: rates[line.item_id] === '' ? 0 : Number(rates[line.item_id]),
        })),
      });
      await openDetail(detail.id);
      await loadList();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision) => {
    if (!detail) return;
    setBusy(true);
    setFormError('');
    try {
      await post(`/pos/${detail.id}/decision`, { decision, remarks: decisionRemarks });
      await openDetail(detail.id);
      await loadList();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shareWhatsApp = async () => {
    if (!detail) return;
    const number = waNumber(detail.vendor_phone);
    const lines = (detail.line_items || [])
      .map((line, index) => `${index + 1}. ${line.item_name} — ${qty(line.qty)} ${line.unit} @ ${inr(line.unit_rate)}`)
      .join('\n');
    const text = [
      `*Purchase Order ${detail.po_code}*`,
      `Date: ${fmtDate(detail.po_date)}`,
      `Vendor: ${detail.vendor_name}`,
      `Delivery: ${detail.delivery_location_type === 'Site' ? detail.site_project_id || 'Site' : 'Kool Mart Store'}`,
      '',
      lines,
      '',
      `Total: ${inr(detail.totals?.total)}`,
      'Kool Mart India Pvt Ltd',
    ].join('\n');
    const url = number
      ? `https://wa.me/91${number}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    try {
      await patch(`/pos/${detail.id}`, { sent_via: 'WhatsApp' });
      await openDetail(detail.id);
      await loadList();
    } catch {
      /* sharing still happened */
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'po_code',
        label: 'PO no',
        render: (r) => (
          <button type="button" className="link-btn mono" onClick={() => openDetail(r.id)}>
            {r.po_code}
          </button>
        ),
      },
      { key: 'po_date', label: 'Date', render: (r) => fmtDate(r.po_date) },
      { key: 'vendor_name', label: 'Vendor' },
      {
        key: 'delivery_location_type',
        label: 'Delivery',
        render: (r) =>
          r.delivery_location_type === 'Site' ? r.site_project_id || 'Site' : 'Store',
      },
      { key: 'line_count', label: 'Items', align: 'right', render: (r) => (r.line_items || []).length },
      { key: 'total', label: 'Value', align: 'right', render: (r) => inr(r.totals?.total) },
      { key: 'approval_status', label: 'Approval', render: (r) => <StatusBadge value={r.approval_status} /> },
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
  if (!data || !options) return <Spinner label="Loading purchase orders…" />;

  const rateEditable = has('po.create') && detail && !['Cancelled', 'Closed'].includes(detail.status);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Direct purchase orders</h1>
          <p>
            Vendor address and GSTIN fill automatically, terms are fixed, and a rate of ₹0 or a pending bill never
            blocks issuing. Approval is optional.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={15} /> New Direct PO
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-red" style={{ marginBottom: 14 }}>{error}</div> : null}

      <DataTable
        columns={columns}
        rows={data.pos}
        exportName="direct-pos"
        initialSort={{ key: 'po_date', dir: 'desc' }}
        empty={
          <EmptyState
            icon="building"
            title="No purchase orders yet"
            description="Raise a Direct PO for a vendor, or create one from an approved MRN."
          />
        }
      />

      {/* ------------------------------ create ------------------------------ */}
      {modalOpen ? (
        <Modal
          wide
          title="New Direct PO"
          subtitle="Auto PO number · vendor address & GSTIN auto-filled · fixed terms"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="po-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : form.approval_required ? 'Send for approval' : 'Issue purchase order'}
              </button>
            </>
          }
        >
          <form id="po-form" onSubmit={submit}>
            {formError ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{formError}</div> : null}
            <div className="form-grid">
              <Field label="Vendor">
                <select
                  className="select"
                  value={form.vendor_id}
                  onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                  required
                >
                  <option value="">Select a vendor…</option>
                  {options.vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.vendor_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="PO date">
                <input
                  type="date"
                  className="input"
                  value={form.po_date}
                  onChange={(e) => setForm({ ...form, po_date: e.target.value })}
                />
              </Field>
              <Field label="Delivery location">
                <select
                  className="select"
                  value={form.delivery_location_type}
                  onChange={(e) => setForm({ ...form, delivery_location_type: e.target.value })}
                >
                  <option value="Store">Kool Mart Store</option>
                  <option value="Site">Site / project</option>
                </select>
              </Field>
              {form.delivery_location_type === 'Site' ? (
                <Field label="Delivery site">
                  <select
                    className="select"
                    value={form.delivery_site_id}
                    onChange={(e) => setForm({ ...form, delivery_site_id: e.target.value })}
                    required
                  >
                    <option value="">Select a site…</option>
                    {options.sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.site_project_id}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Linked MRN" hint="Optional — tie this PO to a site request.">
                <select
                  className="select"
                  value={form.linked_mrn_id}
                  onChange={(e) => setForm({ ...form, linked_mrn_id: e.target.value })}
                >
                  <option value="">No linked MRN</option>
                  {options.mrns
                    .filter((m) => ['Approved', 'Partial', 'Pending'].includes(m.status))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.mrn_no} · {m.site_project_id}
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            <div className="line-list">
              <div className="line-head">
                <strong>Items</strong>
                <span className="faint small">Rate can stay at 0 — update it later when the bill arrives.</span>
              </div>
              {form.lines.map((line, index) => {
                const item = options.items.find((i) => i.id === line.item_id);
                return (
                  <div className="line-row line-row-po" key={index}>
                    <select
                      className="select"
                      value={line.item_id}
                      onChange={(e) => {
                        const picked = options.items.find((i) => i.id === e.target.value);
                        setForm((prev) => ({
                          ...prev,
                          lines: prev.lines.map((l, i) =>
                            i === index
                              ? { ...l, item_id: e.target.value, unit_rate: l.unit_rate === '' ? String(picked?.latest_rate ?? '') : l.unit_rate }
                              : l
                          ),
                        }));
                      }}
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
                      className="input"
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
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input"
                      placeholder="Rate"
                      value={line.unit_rate}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          lines: prev.lines.map((l, i) => (i === index ? { ...l, unit_rate: e.target.value } : l)),
                        }))
                      }
                      aria-label={`Rate ${index + 1}`}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          lines:
                            prev.lines.length > 1 ? prev.lines.filter((_, i) => i !== index) : prev.lines,
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
            </div>

            <div className="divider" />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.approval_required}
                onChange={(e) => setForm({ ...form, approval_required: e.target.checked })}
              />
              <span>
                <strong>Approval required</strong>
                <div className="small muted">
                  Leave unchecked to issue immediately. When checked, the selected Owners / VP or Store Manager must
                  approve before it is sent.
                </div>
              </span>
            </label>

            {form.approval_required ? (
              <div className="approver-list">
                {approvers.map((person) => (
                  <label key={person.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={form.approver_ids.includes(person.id)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          approver_ids: e.target.checked
                            ? [...prev.approver_ids, person.id]
                            : prev.approver_ids.filter((id) => id !== person.id),
                        }))
                      }
                    />
                    <span>
                      {person.full_name}
                      <span className="faint small"> · {person.role === 'owner' ? 'Owner / VP' : 'Store Manager'}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {/* ------------------------------ detail ------------------------------ */}
      {detail ? (
        <Modal
          wide
          title={detail.po_code}
          subtitle={`${detail.vendor_name} · ${fmtDate(detail.po_date)}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPrintPo(detail)}>
                <Icon name="file" size={15} /> Print / PDF
              </button>
              <button type="button" className="btn" onClick={shareWhatsApp}>
                <Icon name="truck" size={15} /> WhatsApp share
              </button>
              {detail.status === 'Pending Approval' && has('po.approve') ? (
                <>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide('reject')}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('approve')}>
                    Approve
                  </button>
                </>
              ) : null}
            </>
          }
        >
          {formError ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{formError}</div> : null}

          <div className="meta-grid">
            <div>
              <span>Status</span>
              <strong><StatusBadge value={detail.status} /></strong>
            </div>
            <div>
              <span>Approval</span>
              <strong><StatusBadge value={detail.approval_status} /></strong>
            </div>
            <div>
              <span>Delivery</span>
              <strong>
                {detail.delivery_location_type === 'Site'
                  ? `${detail.site_project_id} — ${detail.client_project_name}`
                  : 'Kool Mart Store'}
              </strong>
            </div>
            <div>
              <span>Linked MRN</span>
              <strong>{detail.mrn_no || '—'}</strong>
            </div>
            <div>
              <span>Vendor GSTIN</span>
              <strong>{detail.gstin || '—'}</strong>
            </div>
            <div>
              <span>Sent</span>
              <strong>{detail.sent_via ? `${detail.sent_via} · ${fmtDateTime(detail.sent_at)}` : 'Not sent yet'}</strong>
            </div>
          </div>

          <p className="small muted" style={{ margin: '10px 0 14px' }}>{detail.full_address}</p>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(detail.line_items || []).map((line) => (
                  <tr key={line.item_id}>
                    <td>
                      <div>{line.item_name}</div>
                      <div className="small faint mono">{line.item_code}</div>
                    </td>
                    <td className="num">{qty(line.qty)} {line.unit}</td>
                    <td className="num">
                      {rateEditable ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input input-sm"
                          style={{ width: 100, textAlign: 'right' }}
                          value={rates[line.item_id] ?? ''}
                          onChange={(e) => setRates((prev) => ({ ...prev, [line.item_id]: e.target.value }))}
                          aria-label={`Rate for ${line.item_name}`}
                        />
                      ) : (
                        inr(line.unit_rate)
                      )}
                    </td>
                    <td className="num">
                      {inr(
                        Number(line.qty || 0) *
                          Number(rateEditable ? rates[line.item_id] ?? line.unit_rate : line.unit_rate)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rateEditable ? (
            <div className="form-actions" style={{ marginTop: 10 }}>
              <span className="small muted" style={{ marginRight: 'auto' }}>
                Rates are never locked — update them any time before the PO is closed.
              </span>
              <button type="button" className="btn btn-sm" onClick={saveRates} disabled={busy}>
                Save rates
              </button>
            </div>
          ) : null}

          <div className="totals-row">
            <span>Taxable {inr(detail.totals?.taxable)}</span>
            <span>GST {inr(detail.totals?.tax)}</span>
            <strong>Total {inr(detail.totals?.total)}</strong>
          </div>

          {detail.status === 'Pending Approval' && has('po.approve') ? (
            <Field label="Approval remarks">
              <textarea
                className="textarea"
                rows={2}
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
                placeholder="Optional note for the requester"
              />
            </Field>
          ) : null}

          <details className="terms-block">
            <summary>Fixed terms &amp; conditions</summary>
            <pre className="mono-block">{detail.terms_conditions}</pre>
          </details>
        </Modal>
      ) : null}

      {printPo ? (
        <PrintOverlay title={`${printPo.po_code} · Direct PO`} onClose={() => setPrintPo(null)}>
          <PoDocument po={printPo} />
        </PrintOverlay>
      ) : null}
    </div>
  );
}
