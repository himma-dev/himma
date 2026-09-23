// قراءة سجلات NextDNS المحجوبة لعائلة معيّنة
// يعتمد على: profile id + مفتاح API (مخزَّن مشفَّراً في جدول families)
import { decrypt } from './crypto.js';

// الفئات/الأسباب التي نعتبرها "محتوى محظوراً" نُبلغ عنها الأهل
const FLAG_REASONS = [
  'parentalControl:porn',
  'parentalControl',
  'blocklist',
];

export async function fetchNewBlockedLogs(env, family) {
  if (!family.nextdns_profile || !family.nextdns_key_enc) return [];
  const apiKey = await decrypt(env.SECRET_KEY, family.nextdns_key_enc);
  const from = family.last_log_ts ? new Date(family.last_log_ts).toISOString() : '-1h';
  const url = `https://api.nextdns.io/profiles/${family.nextdns_profile}/logs?status=blocked&from=${encodeURIComponent(from)}&limit=50&sort=asc`;
  const r = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.data || []).map((row) => ({
    ts: new Date(row.timestamp).getTime(),
    domain: row.domain,
    device: (row.device && row.device.name) || 'جهاز غير معروف',
    reason: (row.reasons && row.reasons[0] && row.reasons[0].name) || 'محتوى محجوب',
  }));
}
