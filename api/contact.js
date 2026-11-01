'use strict';

/**
 * POST /api/contact
 * Reçoit le formulaire de contact et l'envoie par e-mail, via Resend ou via Gmail.
 * Ne répond { ok: true } que si le service d'envoi a accepté l'e-mail.
 *
 * Variables d'environnement (Vercel > Settings > Environment Variables) — l'une des deux options :
 *   Option A, Resend :
 *     RESEND_API_KEY      clé API Resend (domaine comconnectservice.com vérifié dans Resend)
 *     CONTACT_FROM        (facultatif) expéditeur, par défaut "Cameroun Connect Service <contact@comconnectservice.com>"
 *   Option B, Gmail (utilisée si RESEND_API_KEY est absente) :
 *     GMAIL_USER          adresse Gmail qui envoie les e-mails
 *     GMAIL_APP_PASSWORD  mot de passe d'application Google (16 caractères, validation en 2 étapes requise)
 *   Communes :
 *     CONTACT_TO          (facultatif) destinataire ; par défaut contact@comconnectservice.com (Resend) ou GMAIL_USER (Gmail)
 *     CONTACT_SEND_ACK    (facultatif) "false" pour désactiver l'accusé de réception au visiteur
 */

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_TO = 'contact@comconnectservice.com';
const DEFAULT_FROM = 'Cameroun Connect Service <contact@comconnectservice.com>';
const MIN_FILL_MS = 3000; // un humain met plus de 3 s à remplir le formulaire
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const SUBJECTS = {
  partenariat: { fr: 'Proposition de partenariat', en: 'Partnership proposal' },
  sante: { fr: 'Rejoindre Santé Connect Cameroun', en: 'Join Santé Connect Cameroun' },
  institution: { fr: 'Partenariat institutionnel', en: 'Institutional partnership' },
  presentation: { fr: "Demande de présentation de l'entreprise", en: 'Company presentation request' },
  autre: { fr: 'Autre demande', en: 'Other request' }
};

const hits = new Map();

function rateLimited(ip, now) {
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_MAX;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(v, max) {
  if (typeof v !== 'string') return '';
  // supprime les caractères de contrôle (dont retours à la ligne pour les champs courts)
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function oneLine(v, max) {
  return clean(v, max).replace(/[\r\n]+/g, ' ');
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

function allowedOrigin(origin) {
  if (!origin) return true; // certains navigateurs n'envoient pas Origin sur la même origine
  try {
    const host = new URL(origin).hostname;
    return (
      host === 'comconnectservice.com' ||
      host.endsWith('.comconnectservice.com') ||
      host.endsWith('.vercel.app') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch (e) {
    return false;
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20000) return null;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return null; }
}

function send(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function sendResend(apiKey, payload, fetchImpl) {
  const r = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  let body = {};
  try { body = await r.json(); } catch (e) { /* ignore */ }
  return { ok: r.ok && !!body.id, status: r.status, body };
}

function gmailTransport(user, pass) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

// Choisit le service d'envoi configuré. Retourne null si aucun n'est configuré.
function getMailer(deps) {
  const env = process.env;
  if (env.RESEND_API_KEY) {
    const fetchImpl = (deps && deps.fetch) || globalThis.fetch;
    return {
      name: 'resend',
      from: env.CONTACT_FROM || DEFAULT_FROM,
      to: env.CONTACT_TO || DEFAULT_TO,
      send: (m) => sendResend(env.RESEND_API_KEY, m, fetchImpl)
    };
  }
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    const transport = (deps && deps.transport) || gmailTransport(env.GMAIL_USER, env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''));
    return {
      name: 'gmail',
      from: 'Cameroun Connect Service <' + env.GMAIL_USER + '>',
      to: env.CONTACT_TO || env.GMAIL_USER,
      send: async (m) => {
        const info = await transport.sendMail({
          from: m.from, to: m.to.join(', '), replyTo: m.reply_to, subject: m.subject, html: m.html, text: m.text
        });
        const accepted = (info && info.accepted) || [];
        const rejected = (info && info.rejected) || [];
        return { ok: accepted.length > 0 && rejected.length === 0, status: accepted.length ? 250 : 550, body: { response: info && info.response } };
      }
    };
  }
  return null;
}

async function handler(req, res, deps) {
  const now = (deps && deps.now) || Date.now();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!allowedOrigin(req.headers.origin)) return send(res, 403, { ok: false, error: 'forbidden' });

  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (rateLimited(ip, now)) return send(res, 429, { ok: false, error: 'too_many_requests' });

  const b = await readBody(req);
  if (!b) return send(res, 400, { ok: false, error: 'invalid_body' });

  // Pièges à robots : champ caché rempli ou formulaire envoyé trop vite.
  // On répond comme un succès pour ne pas renseigner le robot, sans rien envoyer.
  const started = Number(b.started);
  if (clean(b.website, 200) || (started && now - started < MIN_FILL_MS)) {
    return send(res, 200, { ok: true });
  }

  const lang = b.lang === 'en' ? 'en' : 'fr';
  const firstName = oneLine(b.firstName, 80);
  const lastName = oneLine(b.lastName, 80);
  const email = oneLine(b.email, 160);
  const subjectKey = Object.prototype.hasOwnProperty.call(SUBJECTS, b.subject) ? b.subject : 'autre';
  const message = clean(b.message, 5000);

  const errors = [];
  if (!firstName) errors.push('firstName');
  if (!lastName) errors.push('lastName');
  if (!EMAIL_RE.test(email)) errors.push('email');
  if (message.length < 10) errors.push('message');
  if (b.consent !== true) errors.push('consent');
  if (errors.length) return send(res, 422, { ok: false, error: 'validation', fields: errors });

  const mailer = getMailer(deps);
  if (!mailer) {
    console.error("[contact] aucun service d'envoi configuré (RESEND_API_KEY ou GMAIL_USER + GMAIL_APP_PASSWORD) : aucun e-mail envoyé");
    return send(res, 503, { ok: false, error: 'not_configured' });
  }
  const to = mailer.to;
  const from = mailer.from;
  const subjectLabel = SUBJECTS[subjectKey].fr;
  const fullName = firstName + ' ' + lastName;

  const html =
    '<h2 style="font-family:Arial,sans-serif">Nouveau message depuis comconnectservice.com</h2>' +
    '<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Nom</td><td>' + esc(fullName) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">E-mail</td><td>' + esc(email) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Objet</td><td>' + esc(subjectLabel) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Langue</td><td>' + lang.toUpperCase() + '</td></tr>' +
    '</table><p style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">' + esc(message) + '</p>' +
    '<p style="font-family:Arial,sans-serif;font-size:12px;color:#888">Le visiteur a accepté la politique de confidentialité.</p>';
  const text =
    'Nom : ' + fullName + '\nE-mail : ' + email + '\nObjet : ' + subjectLabel + '\nLangue : ' + lang.toUpperCase() + '\n\n' + message;

  let main;
  try {
    main = await mailer.send({
      from,
      to: [to],
      reply_to: email,
      subject: '[Site CCS] ' + subjectLabel + ' — ' + fullName,
      html,
      text
    });
  } catch (e) {
    console.error('[contact] erreur d\'envoi (' + mailer.name + ')', e && e.message);
    return send(res, 502, { ok: false, error: 'send_failed' });
  }
  if (!main.ok) {
    console.error('[contact] envoi refusé (' + mailer.name + ')', main.status, JSON.stringify(main.body));
    return send(res, 502, { ok: false, error: 'send_failed' });
  }

  // Accusé de réception au visiteur (un échec ici n'annule pas l'envoi principal).
  if (process.env.CONTACT_SEND_ACK !== 'false') {
    const ack = lang === 'en'
      ? {
          subject: 'We have received your message — Cameroun Connect Service',
          text: 'Hello ' + firstName + ',\n\nThank you for contacting Cameroun Connect Service. We have received your message about "' + SUBJECTS[subjectKey].en + '" and will reply as soon as possible.\n\nThis is an automatic message, please do not reply to it.\n\nCameroun Connect Service\nhttps://www.comconnectservice.com'
        }
      : {
          subject: 'Nous avons bien reçu votre message — Cameroun Connect Service',
          text: 'Bonjour ' + firstName + ',\n\nMerci d\'avoir contacté Cameroun Connect Service. Nous avons bien reçu votre message concernant « ' + SUBJECTS[subjectKey].fr + ' » et vous répondrons dans les meilleurs délais.\n\nCeci est un message automatique, merci de ne pas y répondre.\n\nCameroun Connect Service\nhttps://www.comconnectservice.com'
        };
    try {
      const r = await mailer.send({ from, to: [email], subject: ack.subject, text: ack.text });
      if (!r.ok) console.warn('[contact] accusé de réception non envoyé', r.status);
    } catch (e) {
      console.warn('[contact] accusé de réception non envoyé', e && e.message);
    }
  }

  return send(res, 200, { ok: true });
}

module.exports = (req, res) => handler(req, res);
module.exports.handler = handler;
module.exports._hits = hits;
