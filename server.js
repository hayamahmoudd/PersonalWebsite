const http = require('http');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MAX_BODY_BYTES = 64 * 1024;
const CONTACT_TO = process.env.CONTACT_TO || 'hayasydm1010@gmail.com';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.GMAIL_USER || '';
const SMTP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const FALLBACK_DIR = path.join(ROOT, 'contact-submissions');
const FALLBACK_FILE = process.env.CONTACT_FALLBACK_FILE || path.join(FALLBACK_DIR, 'messages.jsonl');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf'
};

const routeFiles = {
  '/': 'index.html',
  '/Home': 'index.html',
  '/Experience': 'index.html',
  '/Projects': 'index.html',
  '/Skills': 'index.html',
  '/Contact': 'index.html',
  '/coop-reports': 'index.html',
  '/coop-reports/s26': 'summer-2026.html'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanMessage(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, 5000);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(value) {
  const cleanValue = safeHeader(value);
  return /^[\x00-\x7F]*$/.test(cleanValue)
    ? cleanValue
    : `=?UTF-8?B?${Buffer.from(cleanValue, 'utf8').toString('base64')}?=`;
}

function dotStuff(message) {
  return message
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    function cleanup() {
      socket.off('data', onData);
      socket.off('error', onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1] || '';

      if (/^\d{3} /.test(lastLine)) {
        cleanup();
        resolve({ code: Number(lastLine.slice(0, 3)), response: buffer });
      }
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function sendSmtpCommand(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  const result = await readSmtpResponse(socket);
  if (!expectedCodes.includes(result.code)) {
    throw new Error(`SMTP command failed: ${command}`);
  }
  return result;
}

function buildEmail(submission) {
  const subject = submission.subject || `Portfolio message from ${submission.name}`;
  const body = [
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    `Page: ${submission.page || 'Unknown'}`,
    `Received: ${submission.receivedAt}`,
    '',
    submission.message
  ].join('\n');

  return dotStuff([
    `From: Personal Website <${SMTP_USER}>`,
    `To: ${CONTACT_TO}`,
    `Reply-To: ${submission.email}`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: <${submission.id}@personal-website.local>`,
    `Date: ${new Date(submission.receivedAt).toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body
  ].join('\r\n'));
}

async function sendContactEmail(submission) {
  if (!SMTP_USER || !SMTP_PASSWORD) {
    throw new Error('Gmail SMTP credentials are not configured.');
  }

  const socket = tls.connect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    servername: SMTP_HOST
  });

  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });

  try {
    const greeting = await readSmtpResponse(socket);
    if (greeting.code !== 220) throw new Error('SMTP server did not send a greeting.');

    await sendSmtpCommand(socket, 'EHLO personal-website.local', [250]);
    await sendSmtpCommand(socket, 'AUTH LOGIN', [334]);
    await sendSmtpCommand(socket, Buffer.from(SMTP_USER, 'utf8').toString('base64'), [334]);
    await sendSmtpCommand(socket, Buffer.from(SMTP_PASSWORD, 'utf8').toString('base64'), [235]);
    await sendSmtpCommand(socket, `MAIL FROM:<${SMTP_USER}>`, [250]);
    await sendSmtpCommand(socket, `RCPT TO:<${CONTACT_TO}>`, [250, 251]);
    await sendSmtpCommand(socket, 'DATA', [354]);

    socket.write(`${buildEmail(submission)}\r\n.\r\n`);
    const sent = await readSmtpResponse(socket);
    if (sent.code !== 250) throw new Error('SMTP server did not accept the message.');

    await sendSmtpCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

function storeContactSubmission(submission) {
  fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
  fs.appendFileSync(FALLBACK_FILE, `${JSON.stringify(submission)}\n`, 'utf8');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleContact(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const data = JSON.parse(rawBody || '{}');
    const submission = {
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      name: cleanText(data.name, 120),
      email: cleanText(data.email, 160),
      subject: cleanText(data.subject, 180),
      message: cleanMessage(data.message),
      page: cleanText(data.page, 200),
      ip: req.socket.remoteAddress || ''
    };

    if (!submission.name) return sendJson(res, 400, { error: 'Name is required.' });
    if (!isValidEmail(submission.email)) return sendJson(res, 400, { error: 'A valid email is required.' });
    if (!submission.message) return sendJson(res, 400, { error: 'Message is required.' });

    if (!SMTP_USER || !SMTP_PASSWORD) {
      storeContactSubmission(submission);
      sendJson(res, 200, { ok: true, delivery: 'stored' });
      return;
    }

    await sendContactEmail(submission);
    sendJson(res, 200, { ok: true, delivery: 'emailed' });
  } catch (error) {
    console.error(error.message);
    sendJson(res, 500, { error: 'Message could not be sent.' });
  }
}

function resolveStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const routeFile = routeFiles[decodedPath.replace(/\/$/, '') || '/'];
  const requestedFile = routeFile || decodedPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(ROOT, requestedFile);

  if (!absolutePath.startsWith(ROOT)) return null;
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    return path.join(absolutePath, 'index.html');
  }

  return absolutePath;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const filePath = resolveStaticPath(url.pathname);

  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/contact') {
    handleContact(req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
});

server.listen(PORT, () => {
  console.log(`Personal website running at http://localhost:${PORT}`);
  console.log(`Contact messages will be emailed to ${CONTACT_TO}`);
  if (!SMTP_USER || !SMTP_PASSWORD) {
    console.log(`Gmail credentials are missing. Contact messages will be stored in ${FALLBACK_FILE}`);
  }
});
