import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import {
  Badge,
  Card,
  EmptyState,
  Icon,
  Spinner,
  StatusBadge,
  fmtDate,
  fmtDateTime,
  inr,
  qty,
} from '../../ui.jsx';

const ROUTINGS = ['Full Store', 'Split', 'Direct-to-Site'];

function poValue(po) {
  const lines = Array.isArray(po.line_items) ? po.line_items : [];
  return lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.unit_rate || 0), 0);
}

export default function MrnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [routing, setRouting] = useState('Full Store');
  const [remarks, setRemarks] = useState('');
  const [approved, setApproved] = useState({});

  const load = () =>
    get(`/mrn/${id}`)
      .then((result) => {
        setData(result);
        const map = {};
        result.mrn.lines.forEach((line) => {
          map[line.item_id] = String(line.approved_qty ?? line.qty);
        });
        setApproved(map);
        if (result.mrn.routing_type) setRouting(result.mrn.routing_type);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <div className="page">
        <div className="alert alert-red">{error}</div>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/mrn')}>
          <Icon name="return" size={15} /> Back to requests
        </button>
      </div>
    );
  }
  if (!data) return <Spinner label="Loading request…" />;

  const { mrn, stage, linked_pos: linkedPos, linked_challans: linkedChallans, pricingVisible } = data;
  const lines = mrn.lines || [];
  const pending = mrn.status === 'Pending';
  const canDecide = pending && data.canApprove;
  const remainingTotal = lines.reduce((sum, line) => sum + Number(line.remaining_qty || 0), 0);
  const canDispatch = ['Approved', 'Partial'].includes(mrn.status) && remainingTotal > 0;

  const decide = async (decision) => {
    setBusy(true);
    setFormError('');
    try {
      await post(`/mrn/${id}/decision`, {
        decision,
        routing_type: routing,
        remarks,
        line_items: lines.map((line) => ({
          item_id: line.item_id,
          approved_qty: Number(approved[line.item_id] ?? line.qty),
        })),
      });
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumb">
            <Link to="/mrn">Material requests</Link> <span>/</span> {mrn.mrn_no}
          </div>
          <h1>{mrn.mrn_no}</h1>
          <p>
            {mrn.site_project_id} · {mrn.client_project_name} · raised {fmtDate(mrn.mrn_date)} by{' '}
            {mrn.requested_by_name || 'site team'}
          </p>
        </div>
        <div className="actions">
          <StatusBadge value={mrn.status} />
          <StatusBadge value={stage} />
          <button type="button" className="btn" onClick={() => navigate('/mrn')}>
            <Icon name="return" size={15} /> Back
          </button>
        </div>
      </div>

      <div className="grid-2">
        <Card title="Request details" subtitle={`${lines.length} item${lines.length === 1 ? '' : 's'} requested`}>
          <div className="meta-grid">
            <div>
              <span>Required by</span>
              <strong>{fmtDate(mrn.required_date)}</strong>
            </div>
            <div>
              <span>Priority</span>
              <strong>
                <Badge tone={mrn.priority === 'Urgent' ? 'red' : mrn.priority === 'Low' ? 'neutral' : 'blue'}>
                  {mrn.priority}
                </Badge>
              </strong>
            </div>
            <div>
              <span>Routing</span>
              <strong>{mrn.routing_type || '—'}</strong>
            </div>
            <div>
              <span>Raised</span>
              <strong>{fmtDateTime(mrn.created_at)}</strong>
            </div>
          </div>

          {mrn.remarks ? (
            <div className="alert" style={{ marginBottom: 14 }}>
              <Icon name="file" size={15} />
              <div>{mrn.remarks}</div>
            </div>
          ) : null}

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>UOM</th>
                  <th className="num">Requested</th>
                  <th>Line remarks</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.item_id}>
                    <td>
                      <div>{line.item_name}</div>
                      <div className="small faint mono">{line.item_code}</div>
                    </td>
                    <td>{line.unit}</td>
                    <td className="num">{qty(line.qty)}</td>
                    <td className="small muted">{line.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {canDecide ? (
          <Card
            title="Live store stock vs requested"
            subtitle="Approve in full, part-approve a line, or reject the request."
            className="decision-card"
          >
            {formError ? <div className="alert alert-red" style={{ marginBottom: 12 }}>{formError}</div> : null}

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Requested</th>
                    <th className="num">Store stock</th>
                    <th className="num">Approve</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const stock = line.store_stock;
                    const short = stock !== null && stock !== undefined && stock < Number(line.qty);
                    return (
                      <tr key={line.item_id}>
                        <td>
                          <div className="small">{line.item_name}</div>
                          <div className="small faint mono">{line.item_code}</div>
                        </td>
                        <td className="num">
                          {qty(line.qty)} {line.unit}
                        </td>
                        <td className="num">
                          {stock === null || stock === undefined ? (
                            <span className="faint">—</span>
                          ) : (
                            <span className={stock < 0 ? 'negative' : short ? 'warn-text' : ''}>
                              {qty(stock)} {line.unit}
                            </span>
                          )}
                          {short ? (
                            <div className="small warn-text">short by {qty(Number(line.qty) - Number(stock))}</div>
                          ) : null}
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            min="0"
                            max={line.qty}
                            step="0.001"
                            className="input input-sm"
                            style={{ width: 92, textAlign: 'right' }}
                            value={approved[line.item_id] ?? ''}
                            onChange={(e) =>
                              setApproved((prev) => ({ ...prev, [line.item_id]: e.target.value }))
                            }
                            aria-label={`Approved quantity for ${line.item_name}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divider" />

            <div className="field">
              <label htmlFor="routing">Route this request</label>
              <select
                id="routing"
                className="select"
                value={routing}
                onChange={(e) => setRouting(e.target.value)}
              >
                {ROUTINGS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'Split' ? 'Split dispatch (store + vendor)' : option}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="decision-remarks">Decision remarks</label>
              <textarea
                id="decision-remarks"
                className="textarea"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional note sent back to the site"
              />
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide('reject')}>
                Reject
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('approve')}>
                {busy ? 'Saving…' : 'Approve request'}
              </button>
            </div>
          </Card>
        ) : (
          <Card title="Decision" subtitle="Who approved it and how it was routed.">
            {pending ? (
              <div className="alert alert-amber">
                <Icon name="alert" size={15} />
                <div>Waiting for a Store Manager or Admin to approve this request.</div>
              </div>
            ) : (
              <div className="meta-grid">
                <div>
                  <span>Status</span>
                  <strong>
                    <StatusBadge value={mrn.status} />
                  </strong>
                </div>
                <div>
                  <span>Routing</span>
                  <strong>{mrn.routing_type || '—'}</strong>
                </div>
                <div>
                  <span>Decided by</span>
                  <strong>{mrn.decided_by_name || '—'}</strong>
                </div>
                <div>
                  <span>Decided at</span>
                  <strong>{mrn.decided_at ? fmtDateTime(mrn.decided_at) : '—'}</strong>
                </div>
              </div>
            )}
            {mrn.decision_remarks ? (
              <div className="alert" style={{ marginTop: 12 }}>
                <Icon name="file" size={15} />
                <div>{mrn.decision_remarks}</div>
              </div>
            ) : null}
          </Card>
        )}
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        <Card title="Item-wise dispatch progress" subtitle="Requested → approved → dispatched → remaining.">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Requested</th>
                  <th className="num">Approved</th>
                  <th className="num">Dispatched</th>
                  <th className="num">Remaining</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const pct = line.approved_qty
                    ? Math.min(100, Math.round((Number(line.dispatched_qty || 0) / Number(line.approved_qty)) * 100))
                    : 0;
                  return (
                    <tr key={line.item_id}>
                      <td>
                        <div>{line.item_name}</div>
                        <div className="small faint mono">{line.item_code}</div>
                      </td>
                      <td className="num">{qty(line.qty)} {line.unit}</td>
                      <td className="num">{qty(line.approved_qty)} {line.unit}</td>
                      <td className="num">{qty(line.dispatched_qty)} {line.unit}</td>
                      <td className="num">
                        <span className={Number(line.remaining_qty) > 0 ? 'warn-text' : ''}>
                          {qty(line.remaining_qty)} {line.unit}
                        </span>
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <div className="progress">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <span className="small faint">{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Linked documents"
          subtitle="Every Direct PO and challan raised against this request."
          actions={
            canDispatch ? (
              <>
                {has('po.create') ? (
                  <Link className="btn btn-sm" to={`/pos?mrn=${mrn.id}`}>
                    <Icon name="plus" size={14} /> Direct PO
                  </Link>
                ) : null}
                {has('challan.create') ? (
                  <Link className="btn btn-sm btn-primary" to={`/challans?mrn=${mrn.id}`}>
                    <Icon name="truck" size={14} /> Dispatch challan
                  </Link>
                ) : null}
              </>
            ) : null
          }
        >
          <h4 className="sub-head">Direct POs</h4>
          {linkedPos.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>PO no</th>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Delivery</th>
                    <th className="num">Value</th>
                    <th>Approval</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedPos.map((po) => (
                    <tr key={po.id}>
                      <td className="mono">{po.po_code}</td>
                      <td>{fmtDate(po.po_date)}</td>
                      <td>{po.vendor_name}</td>
                      <td>{po.delivery_location_type}</td>
                      <td className="num">{pricingVisible ? inr(poValue(po)) : <span className="faint">Hidden</span>}</td>
                      <td><StatusBadge value={po.approval_status} /></td>
                      <td><StatusBadge value={po.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">No Direct PO linked yet.</p>
          )}

          <h4 className="sub-head" style={{ marginTop: 18 }}>Challans</h4>
          {linkedChallans.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Challan</th>
                    <th>Date</th>
                    <th>Flow</th>
                    <th className="num">Qty</th>
                    <th>Status</th>
                    <th>Signed DC</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedChallans.map((dc) => (
                    <tr key={dc.id}>
                      <td className="mono">{dc.challan_code}</td>
                      <td>{fmtDate(dc.challan_date)}</td>
                      <td>{dc.flow_type === 'Direct Vendor' ? 'Direct-to-Site' : dc.flow_type}</td>
                      <td className="num">{qty(dc.total_qty)}</td>
                      <td><StatusBadge value={dc.status} /></td>
                      <td>
                        <Badge tone={dc.signed_dc_photo_url ? 'green' : 'amber'}>
                          {dc.signed_dc_photo_url ? 'Received' : 'Pending'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">Nothing dispatched against this request yet.</p>
          )}
        </Card>
      </div>

      {!linkedPos.length && !linkedChallans.length && !canDecide ? (
        <EmptyState
          icon="file"
          title="No linked documents"
          description="Create a Direct PO or a dispatch challan to fulfil this request."
        />
      ) : null}
    </div>
  );
}
