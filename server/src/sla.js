/**
 * 48-hour SLA scanner.
 *
 * Flags (once) every delivery challan still missing its signed copy and every
 * return left open beyond 48 hours, then notifies the responsible roles.
 * Non-blocking: flags are advisory and always clearable by the normal workflow.
 */
import { query } from './db.js';
import { notify } from './audit.js';
import { userIdsForRoles } from './settings.js';

const runner = { query };

function summary(rows, pick) {
  const codes = rows.slice(0, 5).map(pick);
  const more = rows.length > codes.length ? ` +${rows.length - codes.length} more` : '';
  return `${codes.join(', ')}${more}`;
}

export async function runSlaScan() {
  const unsigned = await query(
    `UPDATE challans
        SET sla_48h_breach_flag = true, sla_notified_at = now()
      WHERE doc_kind = 'DC'
        AND flow_type IN ('Full Store','Split','Direct Vendor')
        AND signed_dc_photo_url IS NULL
        AND status <> 'Cancelled'
        AND created_at < now() - interval '48 hours'
        AND sla_notified_at IS NULL
      RETURNING id, challan_code`
  );

  if (unsigned.rows.length) {
    const audience = await userIdsForRoles(runner, ['store_manager', 'store_exec', 'store_helper', 'owner', 'admin']);
    await notify(runner, audience, {
      type: 'sla_breach',
      title: `${unsigned.rows.length} challan(s) missing the signed DC beyond 48 hours`,
      body: summary(unsigned.rows, (r) => r.challan_code),
      link: '/dashboards',
      severity: 'critical',
    });
  }

  const openReturns = await query(
    `UPDATE challans
        SET sla_48h_breach_flag = true, sla_notified_at = now()
      WHERE doc_kind = 'RET'
        AND status IN ('Return Raised','Pickup Assigned','Picked Up','Store Received')
        AND return_raised_at < now() - interval '48 hours'
        AND sla_notified_at IS NULL
      RETURNING id, challan_code`
  );

  if (openReturns.rows.length) {
    const audience = await userIdsForRoles(runner, ['store_manager', 'store_exec', 'owner', 'admin']);
    await notify(runner, audience, {
      type: 'sla_breach',
      title: `${openReturns.rows.length} return(s) open beyond 48 hours`,
      body: summary(openReturns.rows, (r) => r.challan_code),
      link: '/dashboards',
      severity: 'critical',
    });
  }

  return {
    unsigned_dc: unsigned.rows.length,
    open_returns: openReturns.rows.length,
  };
}

/** Start the periodic scanner (5 minutes). Safe to call once at boot. */
export function startSlaScanner(intervalMs = 5 * 60 * 1000) {
  const tick = () =>
    runSlaScan().catch((err) => console.error('[sla] scan failed', err.message));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}
