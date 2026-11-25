import { financialYear } from './util.js';

export const DOC_PREFIXES = {
  MRN: 'MRN',
  PO: 'PO',
  DC: 'DC',
  RET: 'RET',
  PUR: 'PUR',
};

/**
 * Concurrency-safe Indian FY document numbering:
 *   KM/<FY>/<PREFIX>/<MM>/<SEQ>
 * Allocation happens inside the caller's transaction; the upsert takes a row
 * lock so two concurrent writers can never receive the same sequence.
 */
export async function nextDocNumber(client, docType, dateStr) {
  const prefix = DOC_PREFIXES[docType];
  if (!prefix) throw new Error(`Unknown document type ${docType}`);

  const fy = financialYear(dateStr);
  const month = Number(dateStr.slice(5, 7));

  const { rows } = await client.query(
    `INSERT INTO document_sequences (doc_type, fy, month, last_value)
     VALUES ($1,$2,$3,1)
     ON CONFLICT (doc_type, fy, month)
     DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [docType, fy, month]
  );

  const seq = String(rows[0].last_value).padStart(3, '0');
  return `KM/${fy}/${prefix}/${String(month).padStart(2, '0')}/${seq}`;
}

/** Seed helper: force the sequence counter forward after inserting fixed codes. */
export async function bumpSequence(client, docType, dateStr, value) {
  const fy = financialYear(dateStr);
  const month = Number(dateStr.slice(5, 7));
  await client.query(
    `INSERT INTO document_sequences (doc_type, fy, month, last_value)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (doc_type, fy, month)
     DO UPDATE SET last_value = GREATEST(document_sequences.last_value, $4)`,
    [docType, fy, month, value]
  );
}
