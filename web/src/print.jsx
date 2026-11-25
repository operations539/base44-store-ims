import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon, fmtDate, inr, qty } from './ui.jsx';

const COMPANY = {
  name: 'KOOL MART INDIA PVT LTD',
  address: 'Kool Mart House, Andheri Kurla Road, Mumbai, Maharashtra 400059',
  contact: '+91 98200 00000 · accounts@koolmart.in',
};

/** Full-screen A4 print surface. Everything else is hidden while printing. */
export function PrintOverlay({ title, onClose, children }) {
  useEffect(() => {
    document.body.classList.add('printing');
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('printing');
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="print-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="print-toolbar no-print">
        <strong>{title}</strong>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="download" size={15} /> Print / Save PDF
        </button>
        <button type="button" className="btn" onClick={onClose}>
          <Icon name="close" size={15} /> Close
        </button>
      </div>
      <div className="print-scroll">{children}</div>
    </div>,
    document.body
  );
}

function DocHeader({ title, code, date, children }) {
  return (
    <header className="doc-head">
      <div>
        <div className="doc-company">{COMPANY.name}</div>
        <div className="doc-addr">{COMPANY.address}</div>
        <div className="doc-addr">{COMPANY.contact}</div>
      </div>
      <div className="doc-title-box">
        <div className="doc-title">{title}</div>
        <div className="doc-code">{code}</div>
        <div className="doc-date">Date: {fmtDate(date)}</div>
        {children}
      </div>
    </header>
  );
}

function Signatures({ labels }) {
  return (
    <div className="doc-signs">
      {labels.map((label) => (
        <div className="doc-sign" key={label}>
          <div className="doc-sign-line" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Direct PO ------------------------------ */
export function PoDocument({ po }) {
  const lines = Array.isArray(po.line_items) ? po.line_items : [];
  const totals = po.totals || { taxable: 0, tax: 0, total: 0 };
  const terms = String(po.terms_conditions || '').split('\n').filter(Boolean);
  const deliveryLabel =
    po.delivery_location_type === 'Site'
      ? `${po.site_project_id || 'Site'} — ${po.client_project_name || ''}`
      : 'Kool Mart Main Store, Mumbai';

  return (
    <section className="print-sheet doc">
      <DocHeader title="PURCHASE ORDER" code={po.po_code} date={po.po_date}>
        <div className="doc-date">Status: {po.status}</div>
      </DocHeader>

      <div className="doc-parties">
        <div>
          <div className="doc-label">Vendor</div>
          <div className="doc-strong">{po.vendor_name}</div>
          <div className="doc-addr">{po.full_address || '—'}</div>
          <div className="doc-addr">GSTIN: {po.gstin || '—'}</div>
          {po.vendor_phone ? <div className="doc-addr">Contact: {po.vendor_phone}</div> : null}
        </div>
        <div>
          <div className="doc-label">Deliver to</div>
          <div className="doc-strong">{deliveryLabel}</div>
          {po.delivery_location_type === 'Site' ? (
            <div className="doc-addr">{po.site_project_id || ''}</div>
          ) : null}
          {po.mrn_no ? <div className="doc-addr">Against MRN: {po.mrn_no}</div> : null}
          <div className="doc-addr">
            Approved: {po.approval_status}
            {po.approval_status === 'Approved' && po.approved_at ? ` · ${fmtDate(po.approved_at)}` : ''}
          </div>
        </div>
      </div>

      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: '6%' }}>Sr</th>
            <th style={{ width: '14%' }}>Item code</th>
            <th>Description</th>
            <th style={{ width: '8%' }}>UOM</th>
            <th style={{ width: '10%' }} className="num">Qty</th>
            <th style={{ width: '12%' }} className="num">Rate</th>
            <th style={{ width: '13%' }} className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const amount = Number(line.qty || 0) * Number(line.unit_rate || 0);
            return (
              <tr key={`${line.item_id}-${index}`}>
                <td>{index + 1}</td>
                <td className="mono">{line.item_code}</td>
                <td>
                  {line.item_name}
                  {line.model_no ? <span className="doc-faint"> · {line.model_no}</span> : null}
                </td>
                <td>{line.unit}</td>
                <td className="num">{qty(line.qty)}</td>
                <td className="num">{inr(line.unit_rate)}</td>
                <td className="num">{inr(amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="doc-totals">
        <div>
          <span>Taxable value</span>
          <strong>{inr(totals.taxable)}</strong>
        </div>
        <div>
          <span>GST</span>
          <strong>{inr(totals.tax)}</strong>
        </div>
        <div className="doc-grand">
          <span>Total</span>
          <strong>{inr(totals.total)}</strong>
        </div>
      </div>

      <div className="doc-terms">
        <div className="doc-label">Terms &amp; conditions</div>
        {terms.map((term) => (
          <div key={term} className="doc-term">
            {term}
          </div>
        ))}
      </div>

      <Signatures labels={['Prepared by — Store', 'Approved by — Management', 'Vendor acknowledgement']} />
      <div className="doc-foot">Computer-generated purchase order · Kool Mart Store IMS</div>
    </section>
  );
}

/* ------------------------------ Delivery Challan ------------------------------ */
const DC_COPIES = ['Store Copy', 'Supervisor / Porter Copy', 'Recipient Copy'];

export function DcDocument({ challan }) {
  const lines = Array.isArray(challan.lines) ? challan.lines : [];

  return (
    <>
      {DC_COPIES.map((copy) => (
        <section className="print-sheet doc" key={copy}>
          <DocHeader title="DELIVERY CHALLAN" code={challan.challan_code} date={challan.challan_date}>
            <div className="doc-copy">{copy}</div>
          </DocHeader>

          <div className="doc-parties">
            <div>
              <div className="doc-label">Deliver to</div>
              <div className="doc-strong">{challan.site_project_id}</div>
              <div className="doc-addr">{challan.client_project_name}</div>
              <div className="doc-addr">{challan.full_site_address || ''}</div>
            </div>
            <div>
              <div className="doc-label">Dispatch details</div>
              <div className="doc-addr">Flow: {challan.flow_type === 'Direct Vendor' ? 'Direct-to-Site' : challan.flow_type}</div>
              <div className="doc-addr">Transport: {challan.transport_mode || '—'}</div>
              {challan.driver_delivery_person_name ? (
                <div className="doc-addr">Driver / Person: {challan.driver_delivery_person_name}</div>
              ) : null}
              {challan.vehicle_no ? <div className="doc-addr">Vehicle: {challan.vehicle_no}</div> : null}
              {challan.mrn_no ? <div className="doc-addr">MRN: {challan.mrn_no}</div> : null}
              {challan.po_code ? <div className="doc-addr">PO: {challan.po_code}</div> : null}
              {challan.vendor_physical_dc_no ? (
                <div className="doc-addr">Vendor DC No: {challan.vendor_physical_dc_no}</div>
              ) : null}
            </div>
          </div>

          <table className="doc-table">
            <thead>
              <tr>
                <th style={{ width: '6%' }}>Sr</th>
                <th style={{ width: '14%' }}>Item code</th>
                <th>Description</th>
                <th style={{ width: '8%' }}>UOM</th>
                <th style={{ width: '10%' }} className="num">Qty</th>
                <th style={{ width: '26%' }}>Serial nos</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id || `${line.item_id}-${index}`}>
                  <td>{line.line_no || index + 1}</td>
                  <td className="mono">{line.item_code}</td>
                  <td>
                    {line.item_name}
                    {line.model_no ? <span className="doc-faint"> · {line.model_no}</span> : null}
                    {line.line_source === 'Vendor' ? <span className="doc-tag">Vendor</span> : null}
                  </td>
                  <td>{line.unit}</td>
                  <td className="num">{qty(line.qty)}</td>
                  <td className="doc-serials">
                    {Array.isArray(line.serial_nos) && line.serial_nos.length
                      ? line.serial_nos.join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {challan.header_remarks ? (
            <div className="doc-terms">
              <div className="doc-label">Remarks</div>
              <div className="doc-term">{challan.header_remarks}</div>
            </div>
          ) : null}

          <div className="doc-note">
            Goods received in good condition. This challan is rate-free — invoice, unit cost and expiry are
            deliberately excluded.
          </div>

          <Signatures labels={['Issued by — Store', 'Driver / Porter', 'Received by — Site']} />
          <div className="doc-foot">Kool Mart Store IMS · {copy}</div>
        </section>
      ))}
    </>
  );
}
