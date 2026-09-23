// حِمى — خادم Cloudflare Worker
// يخدم الواجهات الثابتة من مجلد public، ويوفر واجهة برمجية بسيطة، ويفحص NextDNS كل دقيقة.
import { sha256hex, randToken, randCode, encrypt, decrypt } from './crypto.js';
import { tgSendToFamily } from './telegram.js';
import { fetchNewBlockedLogs } from './nextdns.js';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}
function bad(msg, status = 400) {
  return json({ error: msg }, { status });
}

function bearer(req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function authFamily(req, env) {
  const token = bearer(req);
  if (!token) return null;
  const hash = await sha256hex(token);
  const row = await env.DB.prepare('SELECT * FROM families WHERE token_hash = ?').bind(hash).first();
  return row || null;
}
async function authDevice(req, env) {
  const token = bearer(req);
  if (!token) return null;
  const hash = await sha256hex(token);
  const row = await env.DB.prepare('SELECT * FROM devices WHERE token_hash = ?').bind(hash).first();
  return row || null;
}

function newId(prefix) {
  return prefix + '_' + randToken(8);
}

const DEFAULT_PREFS = {
  push: true, telegram: true, whatsapp: false, sms: false, call: false, escalate: true,
  vpn: true, gamble: true, violence: false,
  schedule: { enabled: false, start: '21:00', end: '07:00' },
};

function isWithinSchedule(schedule) {
  if (!schedule || !schedule.enabled || !schedule.start || !schedule.end) return false;
  const now = new Date();
  const cur = (now.getUTCHours() * 60 + now.getUTCMinutes() + 60) % 1440;
  const [sh, sm] = schedule.start.split(':').map(Number);
  const [eh, em] = schedule.end.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}

async function handleApi(req, env, ctx, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = req.method;

  if (path === '/signup' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const token = randToken(24);
    const tokenHash = await sha256hex(token);
    const id = newId('fam');
    await env.DB.prepare(
      'INSERT INTO families (id, token_hash, child_name, prefs, created_at) VALUES (?,?,?,?,?)'
    ).bind(id, tokenHash, body.childName || 'الطفل', JSON.stringify(DEFAULT_PREFS), Date.now()).run();
    return json({ familyId: id, token });
  }

  if (path.startsWith('/family')) {
    const fam = await authFamily(req, env);
    if (!fam) return bad('غير مصرّح', 401);

    if (path === '/family/state' && method === 'GET') {
      const devices = await env.DB.prepare('SELECT id,name,type,paused,msg_text,msg_until,last_seen FROM devices WHERE family_id = ? ORDER BY created_at').bind(fam.id).all();
      const events = await env.DB.prepare('SELECT id,ts,device_name,domain,reason,acked FROM events WHERE family_id = ? ORDER BY ts DESC LIMIT 30').bind(fam.id).all();
      return json({
        childName: fam.child_name,
        prefs: JSON.parse(fam.prefs || '{}'),
        dnsConnected: !!fam.nextdns_profile,
        devices: devices.results || [],
        events: events.results || [],
      });
    }

    if (path === '/family/prefs' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const prefs = { ...DEFAULT_PREFS, ...JSON.parse(fam.prefs || '{}'), ...body.prefs };
      const childName = body.childName !== undefined ? String(body.childName).slice(0, 30) : fam.child_name;
      await env.DB.prepare('UPDATE families SET prefs = ?, child_name = ? WHERE id = ?').bind(JSON.stringify(prefs), childName, fam.id).run();
      return json({ ok: true });
    }

    if (path === '/family/nextdns' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!body.profileId || !body.apiKey) return bad('أدخل رقم الملف ومفتاح API');
      const enc = await encrypt(env.SECRET_KEY, body.apiKey);
      await env.DB.prepare('UPDATE families SET nextdns_profile = ?, nextdns_key_enc = ? WHERE id = ?').bind(body.profileId, enc, fam.id).run();
      return json({ ok: true });
    }

    if (path === '/family/pair/start' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const code = randCode();
      const secret = randToken(16);
      await env.DB.prepare('INSERT INTO pairings (code, secret, type, expires_at) VALUES (?,?,?,?)')
        .bind(code, fam.id + ':' + secret, body.type || 'tv', Date.now() + 5 * 60 * 1000).run();
      return json({ code });
    }

    if (path.match(/^\/family\/pair\/[0-9]+$/) && method === 'GET') {
      const code = path.split('/').pop();
      const p = await env.DB.prepare('SELECT * FROM pairings WHERE code = ?').bind(code).first();
      if (!p || !p.confirmed) return json({ confirmed: false });
      return json({ confirmed: true });
    }

    if (path === '/family/devices/batch' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return bad('حدّد جهازاً واحداً على الأقل');
      const placeholders = ids.map(() => '?').join(',');
      if (body.action === 'pause') {
        await env.DB.prepare(`UPDATE devices SET paused = 1 WHERE family_id = ? AND id IN (${placeholders})`).bind(fam.id, ...ids).run();
      } else if (body.action === 'resume') {
        await env.DB.prepare(`UPDATE devices SET paused = 0 WHERE family_id = ? AND id IN (${placeholders})`).bind(fam.id, ...ids).run();
      } else if (body.action === 'message') {
        const until = Date.now() + 30 * 1000;
        await env.DB.prepare(`UPDATE devices SET msg_text = ?, msg_until = ? WHERE family_id = ? AND id IN (${placeholders})`)
          .bind(String(body.text || '').slice(0, 80), until, fam.id, ...ids).run();
      } else return bad('إجراء غير معروف');
      return json({ ok: true });
    }

    if (path.match(/^\/family\/devices\/[^/]+$/) && method === 'DELETE') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM devices WHERE id = ? AND family_id = ?').bind(id, fam.id).run();
      return json({ ok: true });
    }

    if (path.match(/^\/family\/events\/[0-9]+\/ack$/) && method === 'POST') {
      const id = path.split('/')[3];
      await env.DB.prepare('UPDATE events SET acked = 1 WHERE id = ? AND family_id = ?').bind(id, fam.id).run();
      return json({ ok: true });
    }

    return bad('غير موجود', 404);
  }

  if (path === '/pair/confirm' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const p = await env.DB.prepare('SELECT * FROM pairings WHERE code = ?').bind(body.code || '').first();
    if (!p || p.expires_at < Date.now()) return bad('الرمز غير صالح أو منتهٍ');
    const [famId] = p.secret.split(':');
    const token = randToken(24);
    const tokenHash = await sha256hex(token);
    const id = newId('dev');
    await env.DB.prepare('INSERT INTO devices (id, family_id, name, type, token_hash, created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, famId, body.name || 'جهاز جديد', p.type, tokenHash, Date.now()).run();
    await env.DB.prepare('UPDATE pairings SET confirmed = 1 WHERE code = ?').bind(body.code).run();
    return json({ deviceId: id, token });
  }

  if (path.startsWith('/device')) {
    const dv = await authDevice(req, env);
    if (!dv) return bad('غير مصرّح', 401);

    if (path === '/device/state' && method === 'GET') {
      await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(Date.now(), dv.id).run();
      const fam = await env.DB.prepare('SELECT prefs FROM families WHERE id = ?').bind(dv.family_id).first().catch(() => null);
      let scheduleActive = false;
      try {
        const prefs = JSON.parse((fam && fam.prefs) || '{}');
        scheduleActive = isWithinSchedule(prefs.schedule);
      } catch (e) {}
      return json({
        name: dv.name,
        paused: !!dv.paused || scheduleActive,
        pausedBySchedule: scheduleActive && !dv.paused,
        message: dv.msg_until > Date.now() ? dv.msg_text : null,
      });
    }
    return bad('غير موجود', 404);
  }

  if (path === '/telegram/webhook' && method === 'POST') {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) return bad('غير مصرّح', 401);
    const update = await req.json().catch(() => ({}));
    const msg = update.message;
    if (msg && msg.text && msg.text.startsWith('/start')) {
      const code = msg.text.replace('/start', '').trim();
      const fam = await env.DB.prepare('SELECT id FROM families WHERE tg_link_code = ?').bind(code).first();
      if (fam) {
        await env.DB.prepare('INSERT OR IGNORE INTO tg_chats (family_id, chat_id) VALUES (?,?)').bind(fam.id, String(msg.chat.id)).run();
        await tgSendToFamily(env, fam.id, '✅ تم ربط حِمى بهذه المحادثة. ستصلك هنا تنبيهات العائلة.');
      }
    }
    return json({ ok: true });
  }

  return bad('غير موجود', 404);
}

async function pollAllFamilies(env) {
  const rows = await env.DB.prepare('SELECT * FROM families WHERE nextdns_profile IS NOT NULL').all();
  for (const fam of rows.results || []) {
    try {
      const logs = await fetchNewBlockedLogs(env, fam);
      if (!logs.length) continue;
      let maxTs = fam.last_log_ts || 0;
      for (const l of logs) {
        await env.DB.prepare(
          'INSERT INTO events (family_id, ts, device_name, domain, kind, reason) VALUES (?,?,?,?,?,?)'
        ).bind(fam.id, l.ts, l.device, l.domain, 'blocked', l.reason).run();
        if (l.ts > maxTs) maxTs = l.ts;
      }
      await env.DB.prepare('UPDATE families SET last_log_ts = ? WHERE id = ?').bind(maxTs, fam.id).run();
      const prefs = JSON.parse(fam.prefs || '{}');
      if (prefs.telegram !== false) {
        const text = `⚠️ <b>تنبيه حِمى</b>\nتم رصد ${logs.length} محاولة دخول لمحتوى محظور.\nآخر محاولة: <code>${logs[logs.length - 1].domain}</code>\nمن جهاز: ${logs[logs.length - 1].device}`;
        await tgSendToFamily(env, fam.id, text);
      }
    } catch (e) {
      console.log('poll error', fam.id, String(e));
    }
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, ctx, url);
      } catch (e) {
        return bad('خطأ في الخادم: ' + String(e && e.message), 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollAllFamilies(env));
  },
};
