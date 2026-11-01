'use strict';
// Tests de la fonction d'envoi d'e-mails (aucun e-mail réel n'est envoyé : l'API Resend est simulée).
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const contact = require('../api/contact.js');

function req(body, opts = {}) {
  const r = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  r.method = opts.method || 'POST';
  r.headers = Object.assign({ origin: 'https://www.comconnectservice.com', 'x-forwarded-for': opts.ip || '1.1.1.' + Math.floor(Math.random() * 250) }, opts.headers || {});
  return r;
}

function res() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; this.json = JSON.parse(b); }
  };
}

const NOW = 1_800_000_000_000;
const valid = () => ({
  firstName: 'Jean', lastName: 'Dupont', email: 'jean@example.com', subject: 'partenariat',
  message: 'Bonjour, je souhaite discuter d\'un partenariat.', consent: true, lang: 'fr',
  started: String(NOW - 20000), website: ''
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

test.beforeEach(() => {
  contact._hits.clear();
  process.env.RESEND_API_KEY = 're_test_key';
  delete process.env.CONTACT_TO;
  delete process.env.CONTACT_FROM;
  delete process.env.CONTACT_SEND_ACK;
});

test('envoi réussi : 200 ok, e-mail principal + accusé de réception', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'a1' } }, { status: 200, body: { id: 'a2' } }]);
  const r = res();
  await contact.handler(req(valid()), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.json, { ok: true });
  assert.strictEqual(f.calls.length, 2);
  assert.deepStrictEqual(f.calls[0].body.to, ['contact@comconnectservice.com']);
  assert.strictEqual(f.calls[0].body.reply_to, 'jean@example.com');
  assert.match(f.calls[0].body.subject, /Proposition de partenariat/);
  assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer re_test_key');
  assert.deepStrictEqual(f.calls[1].body.to, ['jean@example.com']);
  assert.match(f.calls[1].body.subject, /bien reçu/);
});

test('accusé de réception en anglais pour la version EN', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'a1' } }]);
  const r = res();
  await contact.handler(req(Object.assign(valid(), { lang: 'en' })), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 200);
  assert.match(f.calls[1].body.subject, /We have received/);
});

test('Resend refuse : 502 et PAS de confirmation', async () => {
  const f = fakeFetch([{ status: 403, body: { message: 'domain not verified' } }]);
  const r = res();
  await contact.handler(req(valid()), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual(r.json.ok, false);
  assert.strictEqual(f.calls.length, 1, "pas d'accusé de réception si l'envoi principal échoue");
});

test('erreur réseau : 502 et PAS de confirmation', async () => {
  const f = fakeFetch([new Error('ECONNRESET')]);
  const r = res();
  await contact.handler(req(valid()), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual(r.json.ok, false);
});

test('clé API absente : 503, rien envoyé', async () => {
  delete process.env.RESEND_API_KEY;
  const f = fakeFetch([{ status: 200, body: { id: 'x' } }]);
  const r = res();
  await contact.handler(req(valid()), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual(f.calls.length, 0);
});

test("échec de l'accusé de réception n'annule pas l'envoi principal", async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'a1' } }, { status: 422, body: {} }]);
  const r = res();
  await contact.handler(req(valid()), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.json.ok, true);
});

test('validation : champs manquants, e-mail invalide, consentement absent', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'x' } }]);
  const r = res();
  await contact.handler(req({ firstName: '', lastName: 'X', email: 'pas-un-email', message: 'court', consent: false, started: String(NOW - 20000) }), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 422);
  assert.deepStrictEqual(r.json.fields.sort(), ['consent', 'email', 'firstName', 'message']);
  assert.strictEqual(f.calls.length, 0);
});

test('anti-spam : champ caché rempli -> rien envoyé', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'x' } }]);
  const r = res();
  await contact.handler(req(Object.assign(valid(), { website: 'http://spam' })), r, { fetch: f, now: NOW });
  assert.strictEqual(f.calls.length, 0);
});

test('anti-spam : formulaire envoyé en moins de 3 s -> rien envoyé', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'x' } }]);
  const r = res();
  await contact.handler(req(Object.assign(valid(), { started: String(NOW - 500) })), r, { fetch: f, now: NOW });
  assert.strictEqual(f.calls.length, 0);
});

test('limite : 6e envoi en 10 min depuis la même IP -> 429', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'x' } }]);
  let r;
  for (let i = 0; i < 6; i++) {
    r = res();
    await contact.handler(req(valid(), { ip: '9.9.9.9' }), r, { fetch: f, now: NOW + i });
  }
  assert.strictEqual(r.statusCode, 429);
});

test('origine étrangère refusée', async () => {
  const r = res();
  await contact.handler(req(valid(), { headers: { origin: 'https://evil.example' } }), r, { fetch: fakeFetch([]), now: NOW });
  assert.strictEqual(r.statusCode, 403);
});

test('méthode GET refusée', async () => {
  const r = res();
  await contact.handler(req('', { method: 'GET' }), r, { fetch: fakeFetch([]), now: NOW });
  assert.strictEqual(r.statusCode, 405);
});

test('le contenu HTML du visiteur est échappé et les en-têtes ne peuvent pas être injectés', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'a1' } }]);
  const r = res();
  await contact.handler(req(Object.assign(valid(), {
    firstName: 'Jean\r\nBcc: victime@example.com', message: '<script>alert(1)</script> bonjour à tous'
  })), r, { fetch: f, now: NOW });
  assert.strictEqual(r.statusCode, 200);
  const sent = f.calls[0].body;
  assert.ok(!sent.subject.includes('\n'));
  assert.ok(!sent.html.includes('<script>'));
  assert.ok(sent.html.includes('&lt;script&gt;'));
});

test('objet inconnu ramené à « Autre demande »', async () => {
  const f = fakeFetch([{ status: 200, body: { id: 'a1' } }]);
  const r = res();
  await contact.handler(req(Object.assign(valid(), { subject: 'xxx' })), r, { fetch: f, now: NOW });
  assert.match(f.calls[0].body.subject, /Autre demande/);
});
