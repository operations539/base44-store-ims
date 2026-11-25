/** Read a JSON app setting with a caller-supplied default. */
export async function getSetting(runner, key, fallback = {}) {
  const { rows } = await runner.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (!rows.length) return fallback;
  return { ...fallback, ...(rows[0].value || {}) };
}

/** Persist a JSON app setting (merge is the caller's responsibility). */
export async function saveSetting(runner, key, value, userId = null) {
  const { rows } = await runner.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING value`,
    [key, JSON.stringify(value), userId]
  );
  return rows[0].value;
}

/** Every user id holding one of the given roles (notification fan-out). */
export async function userIdsForRoles(runner, roles) {
  const { rows } = await runner.query(
    'SELECT id FROM users WHERE is_active = true AND role = ANY($1::text[])',
    [roles]
  );
  return rows.map((r) => r.id);
}
