/** Ordered, bounded regex rules for known diagnostics. Preserve unknown alerts, negations and numbers. */
export function compactNote(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^Backup data in use:\s*(.+?)\s+(?:is|are) unavailable\.?$/i))) return `Backup · ${match[1]} offline`;
  if ((match = text.match(/^(\d+) data disagreements? detected/i))) return `${match[1]} source conflicts · disputed stop order excluded`;
  if ((match = text.match(/^(\d+) disputed stop sequences?/i))) return `${match[1]} stop-order conflicts · excluded`;
  if (/^Showing saved transit snapshots/i.test(text)) return 'Saved data · original times · >2 min: no current-service proof';
  if (/^Showing static stops/i.test(text)) return 'Static stops · service unconfirmed';
  if ((match = text.match(/^Current stops unavailable for (.+?); verified static stop order/i))) return `${match[1]} · static stops · estimated timing`;
  if ((match = text.match(/^Ordered stops? (?:data )?unavailable for (.+?)[;.]/i))) return `${match[1]} · no stop order · excluded`;
  if (/published routes without current-service evidence/i.test(text)) return 'Service unconfirmed · excluded';
  if ((match = text.match(/^(\d+) route directions? outside the Athens area/i))) return `${match[1]} directions outside Athens · excluded`;
  if ((match = text.match(/^Predictions unavailable at (\d+) stops/i))) return `${match[1]} stops · no ETA · estimated waits`;
  if (/older than two minutes|older than 2 minutes/i.test(text)) return 'GPS >2 min / time unknown';
  if (/vehicle.*(?:clock time without an absolute update date|update dates are unavailable)/i.test(text)) return 'GPS time unknown';
  if (/^Road trace unavailable/i.test(text)) return 'Trace missing · dashed stop connectors';
  if ((match = text.match(/Transit request failed\s*\((\d{3})\)/i))) return `HTTP ${match[1]} · retry${/last received/i.test(text) ? ' · last positions' : ''}`;
  if (/^Athens lock is on\./i.test(text)) return 'Athens only · choose local point / unlock Athens';
  if (/^Your location is outside Athens/i.test(text)) return 'Outside Athens · pick local start / unlock Athens';
  if (/^Location permission was denied/i.test(text)) return 'Location denied · search / pick start';
  if (/^Choose a start and destination from the suggestions/i.test(text)) return 'Select start + destination · suggestions / map / coordinates';
  if (/^The planner loads the full directed route topology/i.test(text)) return 'Live ETA/GPS · fallback wait 7.5 min · estimates, no timetable guarantee';
  if (/^Fastest in this model/i.test(text)) return 'Model estimate · service not guaranteed';
  if ((match = text.match(/^Walks use straight-line distances at ([\d.]+) m\/s/i))) return `Walking: straight line · ${match[1]} m/s · check safe paths`;
  if ((match = text.match(/^Unpublished repeating service is estimated ([\d.]+) minutes/i))) return `Fallback wait: ${match[1]} min after readiness / last departure`;
  if ((match = text.match(/^Unpredicted bus travel.*at ([\d.]+) m\/s plus ([\d.]+) seconds per stop/i))) return `Bus estimate: ${match[1]} m/s + ${match[2]} s/stop · geometry / distance ×1.25`;
  if (/^When a stop ETA is missing/i.test(text)) return 'No stop ETA: recent GPS estimate · faster provider ETA preferred';
  if ((match = text.match(/^Transfers include (\d+) seconds.*older than (\d+) seconds/i))) return `Transfer buffer: ${match[1]} s · ETA age limit: ${match[2]} s`;
  if (/^Operator alternatives|^Operator suggestions are a separate comparison/i.test(text)) return 'Operator comparison · waits may be missing · separate estimate';
  return text.replace(/\bplease(?: note that)?\s+/gi, '')
    .replace(/^(?:there (?:is|are)|the app is|this route is|these routes are)\s+/i, '')
    .replace(/\b(?:is|are) (?:currently )?(unavailable|available|cancelled|canceled|closed|delayed)\b/gi, '$1')
    .replace(/;\s*|[.!?]\s+(?=[A-Z])/g, ' · ').replace(/\s*·\s*/g, ' · ').replace(/[.;]\s*$/, '').trim();
}
