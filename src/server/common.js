import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const developmentSecret = 'ds01-local-development-only-change-before-deployment';
export function getSecret() {
  const secret = process.env.RELAY_SECRET || developmentSecret;
  if (process.env.NODE_ENV === 'production' && (secret === developmentSecret || secret.length < 32)) {
    throw new Error('RELAY_SECRET must contain at least 32 characters in production.');
  }
  return secret;
}
export function issueTicket(peerId, registrationId, secret, ttl = 3600000) {
  const payload = Buffer.from(JSON.stringify({ peerId, registrationId, expiresAt: Date.now() + ttl, nonce: randomUUID() })).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifyTicket(token, secret) {
  try {
    const [payload, signature, extra] = token.split('.');
    if (extra || !payload || !signature) return null;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return ticket.expiresAt > Date.now() ? ticket : null;
  } catch { return null; }
}
export function origins() {
  return (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean);
}
export function socketOptions(allowedOrigins = origins()) {
  return {
    cors: { origin: allowedOrigins },
    allowRequest: (req, done) => done(null, !req.headers.origin || allowedOrigins.includes(req.headers.origin)),
    pingInterval: 5000, pingTimeout: 10000, maxHttpBufferSize: 64 * 1024,
  };
}
export async function listen(server, port, host = '0.0.0.0') {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  return server.address().port;
}
