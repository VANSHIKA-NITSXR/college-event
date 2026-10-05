// College Event Management System - zero-dependency Node.js server
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const ORGANIZER_CODE = process.env.ORGANIZER_CODE || 'ORG2026'; // required to sign up as organizer
const DB_FILE = path.join(__dirname, 'data', 'db.json'), PUBLIC = path.join(__dirname, 'public');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
let db = { users: [], events: [], regs: [], sessions: {} };
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
const uid = () => crypto.randomBytes(6).toString('hex');
const hash = (p, s = crypto.randomBytes(8).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 32).toString('hex');
const verify = (p, h) => hash(p, h.split(':')[0]) === h;

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (c, m) => { if (!c) throw new HttpError(400, m); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(ok => {
  let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } });
});
const currentUser = req => {
  const m = (req.headers.cookie || '').match(/sid=(\w+)/);
  return m && db.users.find(u => u.id === db.sessions[m[1]]);
};
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const cleanEvent = b => {
  const e = {
    title: String(b.title || '').trim(), description: String(b.description || '').trim(),
    category: String(b.category || 'Other'), date: b.date, deadline: b.deadline || b.date,
    venue: String(b.venue || '').trim(), capacity: parseInt(b.capacity, 10), contact: String(b.contact || '').trim()
  };
  need(e.title && e.venue && e.date && e.capacity > 0, 'Title, venue, date and a capacity above 0 are required.');
  need(!isNaN(new Date(e.date)) && !isNaN(new Date(e.deadline)), 'Enter valid dates.');
  need(new Date(e.deadline) <= new Date(e.date), 'Registration deadline must be on or before the event date.');
  return e;
};

async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api\//, '').split('/'), me = currentUser(req);
  const auth = role => {
    if (!me) throw new HttpError(401, 'Please log in first.');
    if (role && me.role !== role) throw new HttpError(403, 'This action is not available for your role.');
  };
  const findEvent = () => { const e = db.events.find(x => x.id === p[1]); if (!e) throw new HttpError(404, 'Event not found.'); return e; };
  const ownEvent = () => { auth('organizer'); const e = findEvent(); if (e.organizerId !== me.id) throw new HttpError(403, 'You can only manage your own events.'); return e; };
  const count = e => db.regs.filter(r => r.eventId === e.id).length;
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  const route = req.method + ' ' + p[0] + (p[2] ? '/' + p[2] : '');

  switch (route) {
    case 'POST signup': {
      const name = String(body.name || '').trim(), email = String(body.email || '').trim().toLowerCase();
      need(name && /^\S+@\S+\.\S+$/.test(email), 'Enter your name and a valid email.');
      need(String(body.password || '').length >= 6, 'Password must be at least 6 characters.');
      need(!db.users.some(u => u.email === email), 'An account with this email already exists.');
      const role = body.role === 'organizer' ? 'organizer' : 'participant';
      if (role === 'organizer') need(body.code === ORGANIZER_CODE, 'Invalid organizer access code.');
      const user = { id: uid(), name, email, role, password: hash(body.password), createdAt: new Date().toISOString() };
      db.users.push(user); return login(res, user);
    }
    case 'POST login': {
      const user = db.users.find(u => u.email === String(body.email || '').trim().toLowerCase());
      need(user && verify(String(body.password || ''), user.password), 'Wrong email or password.');
      return login(res, user);
    }
    case 'POST logout': {
      const m = (req.headers.cookie || '').match(/sid=(\w+)/); if (m) { delete db.sessions[m[1]]; save(); }
      return send(res, 200, { ok: true });
    }
    case 'GET me': return send(res, 200, { user: me ? publicUser(me) : null });
    case 'GET events': {
      auth();
      return send(res, 200, db.events.map(e => ({
        ...e, count: count(e), organizerName: (db.users.find(u => u.id === e.organizerId) || {}).name,
        registered: db.regs.some(r => r.eventId === e.id && r.userId === me.id)
      })).sort((a, b) => new Date(a.date) - new Date(b.date)));
    }
    case 'POST events': {
      auth('organizer'); const e = { id: uid(), organizerId: me.id, ...cleanEvent(body), createdAt: new Date().toISOString() };
      db.events.push(e); save(); return send(res, 201, e);
    }
    case 'PUT events': {
      const e = ownEvent(), n = cleanEvent(body);
      need(n.capacity >= count(e), `Capacity cannot be below the ${count(e)} students already registered.`);
      Object.assign(e, n); save(); return send(res, 200, e);
    }
    case 'DELETE events': {
      const e = ownEvent(); db.events = db.events.filter(x => x !== e); db.regs = db.regs.filter(r => r.eventId !== e.id);
      save(); return send(res, 200, { ok: true });
    }
    case 'POST events/register': {
      auth('participant'); const e = findEvent();
      const f = ['rollNo', 'department', 'year', 'phone'].reduce((o, k) => (o[k] = String(body[k] || '').trim(), o), {});
      need(Object.values(f).every(Boolean), 'Roll number, department, year and phone are all required.');
      need(/^[0-9+\-\s]{7,15}$/.test(f.phone), 'Enter a valid phone number.');
      need(new Date() <= new Date(e.deadline), 'Registration for this event has closed.');
      need(!db.regs.some(r => r.eventId === e.id && r.userId === me.id), 'You are already registered.');
      need(count(e) < e.capacity, 'This event is full.');
      const r = { id: uid(), eventId: e.id, userId: me.id, name: me.name, email: me.email, ...f, attended: false, registeredAt: new Date().toISOString() };
      db.regs.push(r); save(); return send(res, 201, r);
    }
    case 'DELETE events/register': {
      auth('participant'); const e = findEvent();
      db.regs = db.regs.filter(r => !(r.eventId === e.id && r.userId === me.id)); save(); return send(res, 200, { ok: true });
    }
    case 'GET events/registrations': { const e = ownEvent(); return send(res, 200, db.regs.filter(r => r.eventId === e.id)); }
    case 'GET events/export': {
      const e = ownEvent(), cols = ['name', 'email', 'rollNo', 'department', 'year', 'phone', 'attended', 'registeredAt'];
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [cols.join(','), ...db.regs.filter(r => r.eventId === e.id).map(r => cols.map(c => q(r[c])).join(','))].join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${e.title.replace(/\W+/g, '_')}_participants.csv"` });
      return res.end(csv);
    }
    case 'GET mine': {
      auth('participant');
      return send(res, 200, db.regs.filter(r => r.userId === me.id).map(r => ({ ...r, event: db.events.find(e => e.id === r.eventId) })).filter(r => r.event));
    }
    case 'PATCH regs': case 'DELETE regs': {
      auth('organizer'); const r = db.regs.find(x => x.id === p[1]);
      const e = r && db.events.find(x => x.id === r.eventId);
      if (!e || e.organizerId !== me.id) throw new HttpError(404, 'Registration not found.');
      if (req.method === 'PATCH') r.attended = !!body.attended; else db.regs = db.regs.filter(x => x !== r);
      save(); return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Unknown endpoint.');
}
function login(res, user) {
  const sid = crypto.randomBytes(16).toString('hex'); db.sessions[sid] = user.id; save();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` });
  res.end(JSON.stringify({ user: publicUser(user) }));
}

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.code, { error: err.message });
    console.error(err); send(res, 500, { error: 'Server error.' });
  }
}).listen(PORT, () => console.log(`College Event Management System running at http://localhost:${PORT}`));
