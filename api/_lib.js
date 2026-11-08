// Norte Dashboard — utilitários partilhados pelas Vercel Functions.
// Ficheiros começados por "_" dentro de /api não são expostos como rotas.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   CF_ACCOUNT_ID          Account ID da Cloudflare
//   CLOUDFLARE_API_TOKEN   Token com permissão D1 (Edit) nas bases abaixo
//   NORTE_DB_ID            (opcional) UUID da base norte-dashboard-db
//   LEADSEEKER_DB_ID       (opcional) UUID da base leadseeker-db (empresas + decisores)
//   PRESALES_DB_ID         (opcional) UUID da base presales-db (pipeline PACE)
//   STORIES_DB_ID          (opcional) UUID da base stories-db
//   R2_ACCESS_KEY_ID       Chave S3 do R2 (anexos dos contactos)
//   R2_SECRET_ACCESS_KEY   Segredo S3 do R2
//   R2_BUCKET              (opcional) bucket R2, por defeito norte-docs

const crypto = require('crypto');

const DB = {
  norte: () => process.env.NORTE_DB_ID || 'e71e319b-f043-4da4-8cb2-8351247d475c',
  leadseeker: () => process.env.LEADSEEKER_DB_ID || '638edad1-da99-416f-b366-499c3dc7a320',
  presales: () => process.env.PRESALES_DB_ID || '1f2543f7-ebc9-4301-bc93-12b458193ad0',
  stories: () => process.env.STORIES_DB_ID || 'a2276436-900a-4e86-9788-ac85df9700fa',
};

function assertEnv() {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    const e = new Error('Faltam as variáveis CF_ACCOUNT_ID e/ou CLOUDFLARE_API_TOKEN no projeto Vercel.');
    e.status = 500;
    throw e;
  }
}

// Executa uma ou mais queries parametrizadas numa base D1 (HTTP API).
async function d1(db, sql, params = []) {
  assertEnv();
  const id = DB[db] ? DB[db]() : db;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${id}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error((data.errors && data.errors[0] && data.errors[0].message) || 'Erro D1');
  }
  return data.result[0].results;
}

function json(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function query(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

function uid(prefix) {
  return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('base64url');
}

// Texto limpo com limite de tamanho; null quando vazio.
function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max || 20000);
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isoDate(v) {
  const s = str(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      json(res, err.status || 500, { error: err.message });
    }
  };
}

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

// ---------- Cloudflare R2 (API S3, assinatura AWS SigV4 por query string) ----------
function r2Config() {
  const key = process.env.R2_ACCESS_KEY_ID, secret = process.env.R2_SECRET_ACCESS_KEY;
  if (!key || !secret || !process.env.CF_ACCOUNT_ID) {
    const e = new Error('Anexos indisponíveis: faltam R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY no projeto Vercel.');
    e.status = 503;
    throw e;
  }
  return {
    key, secret,
    host: `${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: process.env.R2_BUCKET || 'norte-docs',
  };
}

const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function r2PresignedUrl(method, objectKey, expires, extraQuery) {
  const c = r2Config();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const path = '/' + c.bucket + '/' + objectKey.split('/').map(enc).join('/');
  const q = Object.assign({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.key}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires || 300),
    'X-Amz-SignedHeaders': 'host',
  }, extraQuery || {});
  const qs = Object.keys(q).sort().map((k) => enc(k) + '=' + enc(q[k])).join('&');
  const canonical = [method, path, qs, `host:${c.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + c.secret, day), 'auto'), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `https://${c.host}${path}?${qs}&X-Amz-Signature=${sig}`;
}

async function r2Put(objectKey, buffer, contentType) {
  const url = r2PresignedUrl('PUT', objectKey, 300);
  const res = await fetch(url, { method: 'PUT', body: buffer, headers: { 'Content-Type': contentType || 'application/octet-stream' } });
  if (!res.ok) throw new Error('R2 PUT falhou (' + res.status + ')');
}

async function r2Delete(objectKey) {
  const res = await fetch(r2PresignedUrl('DELETE', objectKey, 300), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error('R2 DELETE falhou (' + res.status + ')');
}

module.exports = {
  DB, d1, json, readBody, query, uid, str, num, isoDate, handler, bad,
  r2PresignedUrl, r2Put, r2Delete,
};
