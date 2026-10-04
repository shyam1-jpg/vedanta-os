/** Local-only design review. Sample availability; no production API or email calls. */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/web-guest/out/', import.meta.url));
const port = Number(process.env.GUEST_PREVIEW_PORT ?? 4318);
const scenario = process.env.GUEST_PREVIEW_SCENARIO ?? 'available';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const property = { name: 'The Vedanta Way', kicker: 'Retreat centre', tagline: 'Luxury retreat centre', about: '', website: 'https://www.thevedanta.org/', company: 'The Vedanta Way Ltd', address: '', check_in_from: '15:00', check_out_by: '11:00', rooms: 41 };
const sampleTypes = [
  { code: 'double', name: 'Double room', sleeps: 2, accessible: false, beds: 'Double bed', features: [], total: 8, available: 3 },
  { code: 'twin', name: 'Twin room', sleeps: 2, accessible: true, beds: 'Two single beds', features: [], total: 6, available: 2 },
];
// Deliberately synthetic fixtures, never published room descriptions.
const sampleRooms = [
  { number: 'G01', section: 'Ground Floor', type_name: 'Twin room', sleeps: 3, beds: '2 single · 1 extra mattress', feature_labels: ['Lake view'], accessible: false },
  { number: 'G02', section: 'Ground Floor', type_name: 'Double room', sleeps: 2, beds: '1 double', feature_labels: ['Lake view', 'Hairdryer'], accessible: false },
  { number: 'G03', section: 'Ground Floor', type_name: 'Twin room', sleeps: 3, beds: '2 single · 1 extra mattress', feature_labels: ['Accessible'], accessible: true },
  { number: '101', section: 'Pink Corridor', type_name: 'Twin room', sleeps: 2, beds: '2 single', feature_labels: ['Lake view', 'Shower'], accessible: false },
  { number: '106', section: 'Pink Corridor', type_name: 'King room', sleeps: 3, beds: '1 king · 1 extra mattress', feature_labels: ['Courtyard view'], accessible: false },
  { number: '119', section: 'First Floor', type_name: 'King room', sleeps: 4, beds: '1 single · 1 king · 1 extra mattress', feature_labels: ['Lake view', 'Desk', 'Hairdryer'], accessible: false },
  { number: '203', section: 'Green Corridor', type_name: 'Twin room', sleeps: 2, beds: '2 single', feature_labels: ['Lake view'], accessible: false },
  { number: '211', section: null, type_name: 'Single room', sleeps: 1, beds: '', feature_labels: [], accessible: false },
];
let enquiry = null;
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };

const server = http.createServer(async (req, res) => {
  // Prevent even a misconfigured build from contacting a live API from this preview.
  res.setHeader('Content-Security-Policy', "connect-src 'self'");
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/guest/')) {
      if (scenario === 'error') return send(res, 503, { detail: 'Simulated preview outage' });
      if (req.method === 'POST') {
        // Deliberately local: do not send an email or create a real booking.
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16000) return send(res, 413, {}); }
        const body = JSON.parse(raw || '{}');
        if (url.pathname === '/guest/email-code/request') return send(res, 200, { message: 'LOCAL PREVIEW: no email was sent. Use 12345678 to test the next step.' });
        if (url.pathname === '/guest/enquiries') {
          if (body.email_code !== '12345678') return send(res, 400, { code: 'guest_email_verification_required', detail: 'Verify your email' });
          enquiry = { ...body, id: 'local-preview', status: 'PENDING', rooms: [], programme_name: null };
          return send(res, 200, { token: 'local-preview-only', user: { name: body.name, email: body.email }, id: 'local-preview', status: 'PENDING', access_code: '123456' });
        }
        return send(res, 400, { detail: 'This is a local design preview. This account action is not connected.' });
      }
      if (req.method !== 'GET') return send(res, 405, { detail: 'Not connected in preview' });
      if (url.pathname === '/guest/property') return send(res, 200, property);
      if (url.pathname === '/guest/programmes') return send(res, 200, { items: [] });
      if (url.pathname === '/guest/calendar') {
        const days = [];
        for (let d = new Date(`${url.searchParams.get('from')}T12:00:00Z`); d.toISOString().slice(0, 10) <= url.searchParams.get('to'); d.setUTCDate(d.getUTCDate() + 1)) {
          days.push({ date: d.toISOString().slice(0, 10), free_rooms: scenario === 'sold-out' ? 0 : sampleRooms.length });
        }
        return send(res, 200, { days });
      }
      if (url.pathname === '/guest/availability') {
        const arrival = url.searchParams.get('arrival'), departure = url.searchParams.get('departure');
        const result = { arrival, departure, nights: (new Date(departure) - new Date(arrival)) / 86400000, free_rooms: scenario === 'sold-out' ? 0 : sampleRooms.length, types: scenario === 'sold-out' ? [] : sampleTypes, rooms: scenario === 'sold-out' ? [] : sampleRooms };
        // A delayed response allows stale-result protection to be checked by editing dates while loading.
        return setTimeout(() => send(res, 200, result), Number(process.env.GUEST_PREVIEW_DELAY ?? 0));
      }
      if (url.pathname === '/guest/me' && enquiry) return send(res, 200, { name: enquiry.name, email: enquiry.email });
      if (url.pathname === '/guest/enquiries') return send(res, 200, { items: enquiry ? [enquiry] : [] });
      if (url.pathname === '/guest/requests') return send(res, 200, { items: [] });
      return send(res, 401, { detail: 'Sign in is not connected in the local preview.' });
    }
    if (url.pathname === '/') { res.writeHead(302, { location: '/book/' }); return res.end(); }
    if (!url.pathname.startsWith('/book/')) { res.writeHead(404); return res.end(); }
    let relative = decodeURIComponent(url.pathname.slice('/book/'.length));
    if (relative.endsWith('/') || !relative) relative += 'index.html';
    const file = resolve(root, relative);
    if (!file.startsWith(resolve(root) + sep) || !(await stat(file)).isFile()) { res.writeHead(404); return res.end(); }
    let content = await readFile(file);
    if (extname(file) === '.html') content = Buffer.from(content.toString().replace('</head>', '<style>body::after{content:"LOCAL PREVIEW · Sample availability · No real bookings";position:fixed;bottom:10px;left:10px;right:10px;z-index:20;width:fit-content;max-width:calc(100% - 20px);background:#f8edd0;color:#263b30;border:1px solid #b69c62;border-radius:4px;padding:8px 12px;font:11px system-ui;pointer-events:none}</style></head>'));
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found. Build web-guest first.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local guest preview: http://127.0.0.1:${port}/book/ (${scenario}; sample data only)`));
