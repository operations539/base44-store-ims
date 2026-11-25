/**
 * Append-only audit trail. Every write path calls this inside the same
 * transaction as the change it records.
 */
export async function writeAudit(client, req, entry) {
  const {
    module,
    recordType = null,
    recordId = null,
    action,
    oldValues = null,
    newValues = null,
    remarks = null,
  } = entry;

  const actorId = req?.actor?.id || null;
  const actorRole = req?.actor?.role || null;
  // An emulation start/stop logs the target explicitly; everything else derives
  // the effective identity from the request.
  const emulated = entry.emulated !== undefined ? !!entry.emulated : !!req?.emulated;
  const effectiveId =
    entry.effectiveUserId !== undefined
      ? entry.effectiveUserId
      : req?.emulated
      ? req.user?.id || null
      : null;

  await client.query(
    `INSERT INTO audit_logs
       (actor_user_id, actor_role, effective_user_id, emulated, module, record_type,
        record_id, action, old_values, new_values, remarks, ip, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      actorId,
      actorRole,
      effectiveId,
      emulated,
      module,
      recordType,
      recordId === null ? null : String(recordId),
      action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      remarks,
      req?.ipAddress || null,
      !!entry.isDemo,
    ]
  );
}

export async function notify(client, userIds, { type, title, body = null, link = null, severity = 'info' }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;
  const values = [];
  const params = [];
  ids.forEach((uid, idx) => {
    const base = idx * 6;
    values.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`
    );
    params.push(uid, type, title, body, link, severity);
  });
  await client.query(
    `INSERT INTO notifications (user_id, type, title, body, link, severity)
     VALUES ${values.join(',')}`,
    params
  );
}
