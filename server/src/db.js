import pg from 'pg';

// numeric -> number (quantities and money are small enough for JS doubles here)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> keep the plain YYYY-MM-DD string (no timezone shifting)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Run a function inside a single transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Recompute cached balances on items_master from the immutable ledger. */
export async function recomputeItemBalances(client, itemIds) {
  const ids = [...new Set(itemIds)].filter(Boolean);
  if (!ids.length) return;
  await client.query(
    `UPDATE items_master i
        SET store_physical_stock = COALESCE(m.stock, 0),
            scrap_qty            = COALESCE(m.scrap, 0)
       FROM (SELECT item_id,
                    SUM(qty)             AS stock,
                    SUM(scrap_qty_delta) AS scrap
               FROM stock_movements
              WHERE item_id = ANY($1::uuid[])
              GROUP BY item_id) m
      WHERE i.id = m.item_id`,
    [ids]
  );
  // items with no movements at all fall back to zero
  await client.query(
    `UPDATE items_master SET store_physical_stock = 0, scrap_qty = 0
      WHERE id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.item_id = items_master.id)`,
    [ids]
  );
}
