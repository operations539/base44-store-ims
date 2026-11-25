import crypto from 'node:crypto';
import { pool, tx, recomputeItemBalances } from './db.js';
import { hashPassword } from './auth.js';
import { bumpSequence } from './numbering.js';
import { refreshMrnStatus } from './operations.js';
import { financialYear, istParts } from './util.js';

export const DEMO_PASSWORD = 'Koolmart@123';

const pad = (n) => String(n).padStart(2, '0');

// Self-contained placeholder for demo signed-DC thumbnails.
const DEMO_SIGNED_DC =
  'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22620%22%3E%3Crect%20width%3D%22480%22%20height%3D%22620%22%20fill%3D%22%23f8fafc%22%2F%3E%3Crect%20x%3D%2214%22%20y%3D%2214%22%20width%3D%22452%22%20height%3D%22592%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%2F%3E%3Ctext%20x%3D%22240%22%20y%3D%2280%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2222%22%20fill%3D%22%231e3a8a%22%3EKOOL%20MART%20INDIA%3C%2Ftext%3E%3Ctext%20x%3D%22240%22%20y%3D%22118%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%23475569%22%3ESIGNED%20DELIVERY%20CHALLAN%20%28DEMO%29%3C%2Ftext%3E%3Ctext%20x%3D%22240%22%20y%3D%22170%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2212%22%20fill%3D%22%2364748b%22%3ESignature%20and%20stamp%20on%20file%3C%2Ftext%3E%3C%2Fsvg%3E';



function dateAgo(days) {
  const { year, month, day } = istParts(new Date(Date.now() - days * 86400000));
  return `${year}-${pad(month)}-${pad(day)}`;
}

const tsAgo = (hours) => new Date(Date.now() - hours * 3600000);

const HIGH_SIDE = [
  ['KMHS-001', 'VRF Systems', 'VRV Outdoor Unit 8 HP', 'RXQ8ARY16', 'nos', 18, 285000, 4, 1],
  ['KMHS-002', 'VRF Systems', 'VRV Outdoor Unit 10 HP', 'RXQ10ARY16', 'nos', 18, 342000, 2, 1],
  ['KMHS-003', 'Split AC', 'Split AC 1.5T 5-Star Inverter', 'FTKM50UV16', 'nos', 28, 52800, 12, 2],
  ['KMHS-004', 'Split AC', 'Split AC 1.0T 3-Star', 'FTKF35TV16', 'nos', 28, 38500, 8, 2],
  ['KMHS-005', 'Cassette AC', 'Cassette AC 2.0T', 'FCKF60TV16', 'nos', 28, 74500, 5, 1],
  ['KMHS-006', 'Ducted AC', 'Ducted AC 5.5T', 'FDYU140AV16', 'nos', 28, 168000, 3, 1],
  ['KMHS-007', 'VRF Systems', 'VRF Indoor Unit 1.5T', 'FXDQ40', 'nos', 18, 41500, 20, 4],
  ['KMHS-008', 'AHU', 'Air Handling Unit 3000 CFM', 'AHU-3000', 'nos', 18, 265000, 1, 1],
  ['KMHS-009', 'Chillers', 'Chiller 30 TR Air Cooled', 'CH-30AC', 'nos', 18, 1250000, 1, 1],
  ['KMHS-010', 'Precision AC', 'Precision AC 5T', 'PAC-5T', 'nos', 18, 385000, 2, 1],
];

const LOW_SIDE = [
  ['KMLS-001', 'Copper Piping', 'Copper Tube 1/4 inch', 'mtr', 18, 285, 480, 300],
  ['KMLS-002', 'Copper Piping', 'Copper Tube 3/8 inch', 'mtr', 18, 395, 320, 200],
  ['KMLS-003', 'Copper Piping', 'Copper Tube 5/8 inch', 'mtr', 18, 620, 150, 100],
  ['KMLS-004', 'Insulation', 'Nitrile Insulation 6mm', 'roll', 18, 1250, 24, 10],
  ['KMLS-005', 'Ducting', 'PVC Duct 4 inch', 'feet', 18, 145, 900, 400],
  ['KMLS-006', 'Ducting', 'GI Sheet 24G', 'sqft', 18, 92, 1200, 500],
  ['KMLS-007', 'Refrigerant', 'Refrigerant R410A', 'kg', 18, 890, 85, 30],
  ['KMLS-008', 'Refrigerant', 'Refrigerant R32', 'kg', 18, 760, 60, 25],
  ['KMLS-009', 'Ducting', 'Flexible Duct 8 inch', 'mtr', 18, 285, 210, 80],
  ['KMLS-010', 'Drainage', 'Drain Pipe 25mm', 'mtr', 18, 48, 640, 200],
  ['KMLS-011', 'Consumables', 'Insulation Tape', 'nos', 18, 35, 150, 200],
  ['KMLS-012', 'Fabrication', 'MS Angle 40x40', 'kg', 18, 78, 480, 150],
  ['KMLS-013', 'Fabrication', 'Welding Rod', 'box', 18, 1450, 18, 20],
  ['KMLS-014', 'Accessories', 'Filter Drier', 'nos', 18, 1850, 40, 12],
  ['KMLS-015', 'Accessories', 'Condensate Pump', 'nos', 18, 3250, 12, 5],
];

const VENDORS = [
  ['V-001', 'Cool Air Systems Pvt Ltd', 'Plot 42, MIDC Industrial Area, Andheri East, Mumbai, Maharashtra 400093', '27AABCC1234D1Z5',
    [{ name: 'Rakesh Mehta', designation: 'Sales Head', phone: '+919820011223', email: 'rakesh@coolairsystems.in' }]],
  ['V-002', 'Bharat HVAC Traders', '18/4 Okhla Industrial Estate Phase II, New Delhi, Delhi 110020', '07AACCB5678E1Z2',
    [{ name: 'Sunil Arora', designation: 'Proprietor', phone: '+919811223344', email: 'sunil@bharathvac.in' }]],
  ['V-003', 'Southcool Distributors', 'No. 27 Anna Salai, Guindy, Chennai, Tamil Nadu 600032', '33AADCS9012F1Z8',
    [{ name: 'Priya Raman', designation: 'Branch Manager', phone: '+919840112233', email: 'priya@southcool.in' }]],
  ['V-004', 'Gujarat Copper House', 'B-11 Naroda GIDC, Ahmedabad, Gujarat 382330', '24AAECG3456H1Z1',
    [{ name: 'Jignesh Patel', designation: 'Partner', phone: '+919909887766', email: 'jignesh@gujaratcopper.in' }]],
  ['V-005', 'Delhi Refrigeration Co', 'C-56 Sector 63, Noida, Uttar Pradesh 201301', '07AAACD7890J1Z4',
    [{ name: 'Amit Khanna', designation: 'Key Accounts', phone: '+919810556677', email: 'amit@delhirefrigeration.in' }]],
];

const SITES = [
  ['SP-001', 'Lodha Belmondo Tower B - HVAC Package', 'Tower B, Lodha Belmondo, Gahunje, Pune, Maharashtra 412101', 'suresh'],
  ['SP-002', 'Prestige Tech Park Phase 3', 'Prestige Tech Park, Marathahalli-Sarjapur Outer Ring Road, Bengaluru, Karnataka 560103', 'suresh'],
  ['SP-003', 'DLF Cyber City Block 9 Retrofit', 'Block 9, DLF Cyber City, DLF Phase 2, Gurugram, Haryana 122002', 'ramesh'],
  ['SP-004', 'Kool Mart Corporate HQ - 4th Floor', 'Kool Mart House, Andheri Kurla Road, Mumbai, Maharashtra 400059', 'ramesh'],
];

const USERS = [
  ['aniket@koolmart.in', 'aniket', 'Aniket Deshpande', 'admin', 'EMP-1001', 'MIS', '+919820000001', false],
  ['parul@koolmart.in', 'parul', 'Parul Kool', 'owner', 'EMP-1002', 'ACC', '+919820000002', true],
  ['karan@koolmart.in', 'karan', 'Karan Kool', 'owner', 'EMP-1003', 'ACC', '+919820000003', true],
  ['bindra@koolmart.in', 'bindra', 'Mr. Bindra', 'owner', 'EMP-1004', 'ACC', '+919820000004', true],
  ['arun@koolmart.in', 'arun', 'Arun Nair', 'store_manager', 'EMP-2001', 'STR', '+919820000005', true],
  ['prashant@koolmart.in', 'prashant', 'Prashant Jadhav', 'store_exec', 'EMP-2002', 'STR', '+919820000006', true],
  ['ravi@koolmart.in', 'ravi', 'Ravi Kumar', 'store_helper', 'EMP-2003', 'STR', '+919820000007', true],
  ['mahesh@koolmart.in', 'mahesh', 'Mahesh Pawar', 'store_helper', 'EMP-2004', 'STR', '+919820000008', true],
  ['suresh@koolmart.in', 'suresh', 'Suresh Patil', 'supervisor', 'EMP-3001', 'PRJ', '+919820000009', true],
  ['ramesh@koolmart.in', 'ramesh', 'Ramesh Yadav', 'supervisor', 'EMP-3002', 'PRJ', '+919820000010', true],
];

const PO_TERMS = [
  '1. Delivery to be made as per the schedule confirmed by Kool Mart India Pvt Ltd.',
  '2. Material must be strictly as per the approved make, model and specification.',
  '3. Invoice to be raised in the name of Kool Mart India Pvt Ltd with correct GSTIN.',
  '4. Payment terms: 30 days from receipt of material and acceptance of invoice.',
  '5. Any rejection on account of quality will be to the vendor account.',
  '6. This purchase order is subject to Mumbai jurisdiction only.',
].join('\n');

export async function seedDemo() {
  return tx(async (client) => {
    const existing = await client.query('SELECT count(*)::int AS n FROM users WHERE is_demo = true');
    if (existing.rows[0].n > 0) {
      return { skipped: true, reason: 'Demo data already present' };
    }

    const today = dateAgo(0);
    const fy = financialYear(today);
    const mm = today.slice(5, 7);
    const doc = (kind, seq) => `KM/${fy}/${kind}/${mm}/${String(seq).padStart(3, '0')}`;

    // ---------------- users ----------------
    const userIds = {};
    const pwd = hashPassword(DEMO_PASSWORD);
    for (const [email, username, name, role, empId, dept, phone, isDemo] of USERS) {
      const { rows } = await client.query(
        `INSERT INTO users (email, username, password_hash, full_name, role, employee_id,
                            department_code, phone, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [email, username, pwd, name, role, empId, dept, phone, isDemo]
      );
      userIds[username] = rows[0].id;
    }

    // ---------------- vendors ----------------
    const vendorIds = {};
    for (const [code, name, address, gstin, contacts] of VENDORS) {
      const { rows } = await client.query(
        `INSERT INTO vendors_master (vendor_id, vendor_name, full_address, gstin, contact_persons, is_demo)
         VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        [code, name, address, gstin, JSON.stringify(contacts)]
      );
      vendorIds[code] = rows[0].id;
    }

    // ---------------- sites ----------------
    const siteIds = {};
    for (const [code, name, address, supervisor] of SITES) {
      const { rows } = await client.query(
        `INSERT INTO sites_master (site_project_id, client_project_name, full_site_address,
                                   assigned_supervisor_id, is_demo)
         VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [code, name, address, userIds[supervisor]]
      );
      siteIds[code] = rows[0].id;
    }

    // ---------------- items + opening stock ----------------
    const itemIds = {};
    const opening = [];
    for (const [code, prodCat, name, model, unit, tax, rate, qty, min] of HIGH_SIDE) {
      const { rows } = await client.query(
        `INSERT INTO items_master (item_code, category, prod_category, item_name, model_no, unit,
                                   tax_percent, latest_rate, min_qty_alert, is_demo)
         VALUES ($1,'High Side',$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
        [code, prodCat, name, model, unit, tax, rate, min]
      );
      itemIds[code] = rows[0].id;
      opening.push([rows[0].id, qty, unit]);
    }
    for (const [code, prodCat, name, unit, tax, rate, qty, min] of LOW_SIDE) {
      const { rows } = await client.query(
        `INSERT INTO items_master (item_code, category, prod_category, item_name, unit,
                                   tax_percent, latest_rate, min_qty_alert, is_demo)
         VALUES ($1,'Low Side',$2,$3,$4,$5,$6,$7,true) RETURNING id`,
        [code, prodCat, name, unit, tax, rate, min]
      );
      itemIds[code] = rows[0].id;
      opening.push([rows[0].id, qty, unit]);
    }

    const movement = (itemId, qty, unit, type, refType, refNo, notes, scrap = 0, when = null) =>
      client.query(
        `INSERT INTO stock_movements (item_id, qty, scrap_qty_delta, unit, movement_type,
                                      ref_type, ref_no, notes, is_demo, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
        [itemId, qty, scrap, unit, type, refType, refNo, notes, when || new Date()]
      );

    for (const [id, qty, unit] of opening) {
      await movement(id, qty, unit, 'opening', 'opening', 'OPENING-2026-27', 'Opening stock, FY 2026-27');
    }

    // ---------------- material requests ----------------
    const mrn = async (seq, site, status, routing, priority, daysAgo, lines, remarks = null) => {
      const { rows } = await client.query(
        `INSERT INTO material_requests (mrn_no, mrn_date, site_id, requested_by, required_date,
                                        priority, status, routing_type, line_items, decision_remarks,
                                        decided_by, decided_at, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING id`,
        [doc('MRN', seq), dateAgo(daysAgo), siteIds[site], userIds.suresh, dateAgo(daysAgo - 3),
         priority, status, routing, JSON.stringify(lines), remarks,
         status === 'Pending' ? null : userIds.arun,
         status === 'Pending' ? null : tsAgo(daysAgo * 24 - 2)]
      );
      return rows[0].id;
    };

    const mrn1 = await mrn(1, 'SP-001', 'Pending', null, 'Urgent', 0, [
      { item_id: itemIds['KMHS-003'], item_code: 'KMHS-003', item_name: 'Split AC 1.5T 5-Star Inverter', unit: 'nos', qty: 2, remarks: 'Bedroom wing' },
      { item_id: itemIds['KMLS-001'], item_code: 'KMLS-001', item_name: 'Copper Tube 1/4 inch', unit: 'mtr', qty: 50, remarks: null },
    ]);
    const mrn2 = await mrn(2, 'SP-002', 'Approved', 'Full Store', 'Normal', 4, [
      { item_id: itemIds['KMHS-007'], item_code: 'KMHS-007', item_name: 'VRF Indoor Unit 1.5T', unit: 'nos', qty: 6, remarks: '3rd floor fitout' },
      { item_id: itemIds['KMLS-002'], item_code: 'KMLS-002', item_name: 'Copper Tube 3/8 inch', unit: 'mtr', qty: 40, remarks: null },
    ], 'Approved for full store dispatch');
    const mrn3 = await mrn(3, 'SP-003', 'Partial', 'Split', 'Normal', 6, [
      { item_id: itemIds['KMHS-004'], item_code: 'KMHS-004', item_name: 'Split AC 1.0T 3-Star', unit: 'nos', qty: 2, remarks: null },
      { item_id: itemIds['KMLS-005'], item_code: 'KMLS-005', item_name: 'PVC Duct 4 inch', unit: 'feet', qty: 100, remarks: 'Vendor supply' },
    ], 'Store has AC units, duct to be supplied by vendor');
    const mrn4 = await mrn(4, 'SP-004', 'Fulfilled', 'Direct-to-Site', 'Normal', 9, [
      { item_id: itemIds['KMHS-005'], item_code: 'KMHS-005', item_name: 'Cassette AC 2.0T', unit: 'nos', qty: 1, remarks: 'Direct to site' },
    ], 'Delivered direct by vendor');

    // ---------------- direct POs ----------------
    const po = async (seq, vendor, mrnId, location, site, lines, opts = {}) => {
      const { rows } = await client.query(
        `INSERT INTO direct_pos (po_code, po_date, vendor_id, linked_mrn_id, delivery_location_type,
                                 delivery_site_id, auto_vendor_address, terms_conditions,
                                 approval_required, approval_status, line_items, status, sent_via,
                                 sent_at, account_verification_status, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Pending',true) RETURNING id`,
        [doc('PO', seq), dateAgo(opts.daysAgo ?? 5), vendorIds[vendor], mrnId, location, site,
         VENDORS.find((v) => v[0] === vendor)[2], PO_TERMS,
         !!opts.approvalRequired, opts.approvalRequired ? 'Pending' : 'Not Required',
         JSON.stringify(lines), opts.status || 'Issued', opts.sentVia || null,
         opts.sentVia ? tsAgo(20) : null]
      );
      return rows[0].id;
    };

    const po1 = await po(1, 'V-001', mrn3, 'Site', siteIds['SP-003'], [
      { item_id: itemIds['KMLS-005'], item_code: 'KMLS-005', item_name: 'PVC Duct 4 inch', unit: 'feet', qty: 100, unit_rate: 0 },
    ], { daysAgo: 6 });
    const po2 = await po(2, 'V-002', mrn4, 'Site', siteIds['SP-004'], [
      { item_id: itemIds['KMHS-005'], item_code: 'KMHS-005', item_name: 'Cassette AC 2.0T', unit: 'nos', qty: 1, unit_rate: 74500 },
    ], { daysAgo: 10, sentVia: 'WhatsApp', status: 'Sent' });

    // ---------------- challans ----------------
    const shareToken = () => `sh_${crypto.randomBytes(9).toString('hex')}`;

    const challan = async (kind, seq, fields) => {
      const cols = Object.keys(fields);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const { rows } = await client.query(
        `INSERT INTO challans (${cols.join(',')}, is_demo) VALUES (${placeholders.join(',')}, true) RETURNING id`,
        cols.map((c) => fields[c])
      );
      return rows[0].id;
    };

    const addLine = (challanId, lineNo, itemCode, qty, source, extra = {}) =>
      client.query(
        `INSERT INTO challan_lines (challan_id, line_no, item_id, qty, unit, line_source,
                                    serial_nos, return_condition, inspection_remarks,
                                    received_usable_qty, received_scrap_qty, short_missing_qty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [challanId, lineNo, itemIds[itemCode], qty, extra.unit || unitFor(itemCode), source,
         JSON.stringify(extra.serials || []), extra.condition || null, extra.remarks || null,
         extra.usable ?? null, extra.scrap ?? null, extra.short ?? null]
      );

    const unitFor = (code) => {
      const hs = HIGH_SIDE.find((i) => i[0] === code);
      if (hs) return hs[4];
      return LOW_SIDE.find((i) => i[0] === code)[3];
    };

    // DC-1: full store dispatch, delivered & signed
    const dc1 = await challan('DC', 1, {
      challan_code: doc('DC', 1),
      doc_kind: 'DC',
      challan_date: dateAgo(4),
      linked_mrn_id: mrn2,
      site_id: siteIds['SP-002'],
      flow_type: 'Full Store',
      transport_mode: 'Internal EECO',
      driver_delivery_person_name: 'Ganesh Shinde',
      driver_phone: '+919820044556',
      vehicle_no: 'MH 01 AB 4521',
      header_remarks: 'Dispatched from main store',
      status: 'Delivered-Signed',
      signed_dc_photo_url: DEMO_SIGNED_DC,
      site_share_link: shareToken(),
      source_department: 'STR',
    });
    await addLine(dc1, 1, 'KMHS-007', 6, 'Store', { serials: ['FXDQ40-26-0101', 'FXDQ40-26-0102', 'FXDQ40-26-0103', 'FXDQ40-26-0104', 'FXDQ40-26-0105', 'FXDQ40-26-0106'] });
    await addLine(dc1, 2, 'KMLS-002', 40, 'Store');
    await movement(itemIds['KMHS-007'], -6, 'nos', 'challan_out', 'challan', doc('DC', 1), 'Full store dispatch to SP-002', 0, tsAgo(96));
    await movement(itemIds['KMLS-002'], -40, 'mtr', 'challan_out', 'challan', doc('DC', 1), 'Full store dispatch to SP-002', 0, tsAgo(96));

    // DC-2: split dispatch (store + vendor) — signed DC missing, SLA breached
    const dc2 = await challan('DC', 2, {
      challan_code: doc('DC', 2),
      doc_kind: 'DC',
      challan_date: dateAgo(3),
      linked_mrn_id: mrn3,
      linked_po_id: po1,
      site_id: siteIds['SP-003'],
      flow_type: 'Split',
      transport_mode: 'Third-Party Porter',
      driver_delivery_person_name: 'Imran Shaikh',
      driver_phone: '+919820077889',
      vehicle_no: 'HR 26 DK 7788',
      header_remarks: 'AC units from store, duct supplied by vendor on same vehicle',
      status: 'Issued',
      site_share_link: shareToken(),
      sla_48h_breach_flag: true,
      source_department: 'STR',
    });
    await addLine(dc2, 1, 'KMHS-004', 2, 'Store', { serials: ['FTKF35-26-2210', 'FTKF35-26-2211'] });
    await addLine(dc2, 2, 'KMLS-005', 100, 'Vendor');
    await movement(itemIds['KMHS-004'], -2, 'nos', 'challan_out', 'challan', doc('DC', 2), 'Split dispatch - store line only', 0, tsAgo(72));

    // DC-3: direct vendor to site
    const dc3 = await challan('DC', 3, {
      challan_code: doc('DC', 3),
      doc_kind: 'DC',
      challan_date: dateAgo(9),
      linked_mrn_id: mrn4,
      linked_po_id: po2,
      site_id: siteIds['SP-004'],
      vendor_id: vendorIds['V-002'],
      flow_type: 'Direct Vendor',
      transport_mode: 'Vendor Direct',
      driver_delivery_person_name: 'Vendor delivery team',
      vendor_physical_dc_no: 'BRT/DC/2026/0912',
      status: 'Delivered-Signed',
      signed_dc_photo_url: DEMO_SIGNED_DC,
      site_share_link: shareToken(),
      source_department: 'STR',
    });
    await addLine(dc3, 1, 'KMHS-005', 1, 'Vendor', { serials: ['FCKF60-26-0315'] });

    // DC-4: minus-stock override (store had 1 chiller, 2 dispatched)
    const dc4 = await challan('DC', 4, {
      challan_code: doc('DC', 4),
      doc_kind: 'DC',
      challan_date: dateAgo(1),
      site_id: siteIds['SP-002'],
      flow_type: 'Full Store',
      transport_mode: 'Internal EECO',
      driver_delivery_person_name: 'Ganesh Shinde',
      driver_phone: '+919820044556',
      vehicle_no: 'MH 01 AB 4521',
      header_remarks: 'Urgent site requirement approved by Store Manager',
      status: 'Issued',
      site_share_link: shareToken(),
      override_minus_stock_flag: true,
      source_department: 'STR',
    });
    await addLine(dc4, 1, 'KMHS-009', 2, 'Store', { serials: ['CH30-26-0001'] });
    await movement(itemIds['KMHS-009'], -2, 'nos', 'challan_out', 'challan', doc('DC', 4), 'Minus-stock override dispatch to SP-002', 0, tsAgo(24));

    // ---------------- returns (5-stage tracking) ----------------
    const ret1 = await challan('RET', 1, {
      challan_code: doc('RET', 1),
      doc_kind: 'RET',
      challan_date: dateAgo(7),
      site_id: siteIds['SP-001'],
      flow_type: 'Return Store',
      transport_mode: 'Field Staff',
      driver_delivery_person_name: 'Suresh Patil',
      driver_phone: '+919820000009',
      header_remarks: 'Excess copper returned after completion',
      status: 'Closed',
      return_raised_at: tsAgo(168),
      pickup_assigned_at: tsAgo(160),
      picked_up_at: tsAgo(150),
      store_received_at: tsAgo(144),
      system_posted_at: tsAgo(140),
      received_photo_url: 'https://images.koolmart.in/demo/return-received-ret001.jpg',
      signed_return_dc_photo_url: 'https://images.koolmart.in/demo/return-signed-ret001.jpg',
      site_share_link: shareToken(),
      source_department: 'STR',
    });
    await addLine(ret1, 1, 'KMLS-001', 20, 'Store', {
      condition: 'Usable', remarks: '14 mtr usable, 6 mtr damaged', usable: 14, scrap: 6, short: 0,
    });
    await movement(itemIds['KMLS-001'], 14, 'mtr', 'return_usable', 'challan', doc('RET', 1), 'Usable return posted', 0, tsAgo(140));
    await movement(itemIds['KMLS-001'], 0, 'mtr', 'return_scrap', 'challan', doc('RET', 1), 'Damaged length moved to scrap', 6, tsAgo(140));

    // RET-2: return to vendor, store received but not yet posted, short/missing flagged
    const ret2 = await challan('RET', 2, {
      challan_code: doc('RET', 2),
      doc_kind: 'RET',
      challan_date: dateAgo(5),
      site_id: siteIds['SP-003'],
      vendor_id: vendorIds['V-001'],
      flow_type: 'Return Vendor',
      transport_mode: 'Third-Party Porter',
      driver_delivery_person_name: 'Imran Shaikh',
      driver_phone: '+919820077889',
      vehicle_no: 'HR 26 DK 7788',
      header_remarks: 'Surplus duct returned to vendor',
      status: 'Store Received',
      return_raised_at: tsAgo(120),
      pickup_assigned_at: tsAgo(110),
      picked_up_at: tsAgo(100),
      store_received_at: tsAgo(60),
      received_photo_url: 'https://images.koolmart.in/demo/return-received-ret002.jpg',
      signed_return_dc_photo_url: 'https://images.koolmart.in/demo/return-signed-ret002.jpg',
      short_missing_flagged: true,
      sla_48h_breach_flag: true,
      site_share_link: shareToken(),
      source_department: 'STR',
    });
    await addLine(ret2, 1, 'KMLS-005', 30, 'Store', {
      condition: 'Usable', remarks: '18 usable, 2 scrap, 10 short at store gate', usable: 18, scrap: 2, short: 10,
    });

    // ---------------- purchasing entries ----------------
    const purchase = async (seq, vendor, poId, itemCode, qty, rate, tax, billStatus, billNo, daysAgo) => {
      const total = Math.round(qty * rate * (1 + tax / 100) * 100) / 100;
      const { rows } = await client.query(
        `INSERT INTO purchasing_entries (purchase_id, entry_date, linked_po_id, vendor_id, item_id,
                                         qty, bill_status, bill_no, rate, tax_percent, total_amount, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING id`,
        [doc('PUR', seq), dateAgo(daysAgo), poId, vendorIds[vendor], itemIds[itemCode], qty,
         billStatus, billNo, rate, tax, total]
      );
      return rows[0].id;
    };

    await purchase(1, 'V-001', po1, 'KMLS-005', 100, 0, 18, 'Pending', null, 5);
    await movement(itemIds['KMLS-005'], 100, 'feet', 'purchase', 'purchase', doc('PUR', 1), 'Goods received, bill pending', 0, tsAgo(120));
    await purchase(2, 'V-003', null, 'KMLS-007', 20, 890, 18, 'Received', 'SC/2026/1187', 12);
    await movement(itemIds['KMLS-007'], 20, 'kg', 'purchase', 'purchase', doc('PUR', 2), 'Refrigerant cylinder received', 0, tsAgo(288));

    // ---------------- notifications ----------------
    const note = (user, type, title, body, severity = 'info', link = null) =>
      client.query(
        `INSERT INTO notifications (user_id, type, title, body, link, severity, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [userIds[user], type, title, body, link, severity]
      );

    await note('arun', 'mrn_submitted', 'New MRN awaiting approval', `${doc('MRN', 1)} raised by Suresh Patil for Lodha Belmondo Tower B.`, 'warning', '/m/requests');
    await note('arun', 'sla_breach', 'Signed DC missing beyond 48 hours', `${doc('DC', 2)} to DLF Cyber City Block 9 is still awaiting the signed copy.`, 'critical');
    await note('arun', 'return_short', 'Return short/missing flagged', `${doc('RET', 2)} has 10 feet short at store gate and needs final posting.`, 'critical');
    await note('prashant', 'po_pending_bill', 'Vendor bill pending', `${doc('PO', 1)} material received with rate 0. Update the rate when the bill arrives.`, 'warning');
    await note('suresh', 'mrn_approved', 'MRN approved', `${doc('MRN', 2)} approved for full store dispatch.`, 'info');
    await note('aniket', 'demo_seeded', 'Demo dataset loaded', 'Kool Mart HVAC demo records are ready to explore.', 'info');

    // ---------------- audit trail samples ----------------
    const audit = (module, recordType, recordId, action, remarks, oldV, newV) =>
      client.query(
        `INSERT INTO audit_logs (actor_user_id, actor_role, module, record_type, record_id, action,
                                 old_values, new_values, remarks, is_demo)
         VALUES ($1,'store_manager',$2,$3,$4,$5,$6,$7,$8,true)`,
        [userIds.arun, module, recordType, recordId, action,
         oldV ? JSON.stringify(oldV) : null, newV ? JSON.stringify(newV) : null, remarks]
      );

    await audit('Dispatch', 'challans', doc('DC', 4), 'MINUS_STOCK_OVERRIDE', 'Approved minus-stock dispatch for chiller', null, { item: 'KMHS-009', qty: 2, balance_after: -1 });
    await audit('Returns', 'challans', doc('RET', 1), 'RETURN_POSTED', 'Usable 14 mtr to store, 6 mtr to scrap', null, { usable: 14, scrap: 6, short: 0 });
    await audit('Masters', 'items_master', 'KMHS-009', 'CREATE_ITEM', 'Demo seed', null, { item_code: 'KMHS-009' });

    // ---------------- settings ----------------
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES
         ('po_terms', $1),
         ('messaging', $2),
         ('documents', $3)
       ON CONFLICT (key) DO NOTHING`,
      [
        JSON.stringify({ terms: PO_TERMS }),
        JSON.stringify({ email_enabled: false, whatsapp_enabled: true, whatsapp_mode: 'smart_link', event_toggles: {} }),
        JSON.stringify({ dc_copies: ['Store Copy', 'Supervisor / Porter Copy', 'Recipient Copy'], show_rates_on_dc: false }),
      ]
    );

    // ---------------- sequences ----------------
    await bumpSequence(client, 'MRN', today, 4);
    await bumpSequence(client, 'PO', today, 2);
    await bumpSequence(client, 'DC', today, 4);
    await bumpSequence(client, 'RET', today, 2);
    await bumpSequence(client, 'PUR', today, 2);

    const allItems = Object.values(itemIds);
    await recomputeItemBalances(client, allItems);

    // Derive MRN statuses from the dispatch ledger so the demo data is coherent.
    for (const id of [mrn1, mrn2, mrn3, mrn4]) {
      await refreshMrnStatus(client, id);
    }

    return {
      skipped: false,
      users: USERS.length,
      vendors: VENDORS.length,
      sites: SITES.length,
      items: HIGH_SIDE.length + LOW_SIDE.length,
      password: DEMO_PASSWORD,
    };
  });
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('seed.js');
if (isDirectRun) {
  seedDemo()
    .then((summary) => {
      console.log('[seed]', JSON.stringify(summary));
      return pool.end();
    })
    .catch((err) => {
      console.error('[seed] fatal', err);
      process.exit(1);
    });
}
