// lib/core.js — fonctions partagées par toutes les routes /api
// Aucune dépendance npm : on utilise seulement fetch et le module crypto de Node.
import crypto from 'node:crypto';

/* ================= 1. Entrées et sorties ================= */

export function repondre(res, statut, corps) {
  return res.status(statut).json(corps);
}

// Vercel remplit req.body ; on gère aussi le cas "texte brut".
export function lireJson(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return typeof b === 'object' ? b : {};
}

// Supprime les caractères de contrôle et coupe le texte à une longueur maximale.
export function nettoyerTexte(valeur, max) {
  return String(valeur ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max);
}

// Nettoyage du texte renvoyé par l'IA (aucun < ni > : première barrière contre le XSS).
export function purger(valeur, max) {
  return String(valeur ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

// Accepte uniquement une vraie image en base64 de moins de ~1,1 Mo.
export function lireImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 1_500_000) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { media_type: m[1], data: m[2] } : null;
}

/* ================= 2. Identifier le visiteur ================= */

// On ne stocke jamais l'IP en clair : seulement une empreinte (RGPD).
export function empreinteClient(req) {
  const brut =
    req.headers['x-vercel-forwarded-for'] ||
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    'inconnu';
  const ip = String(brut).split(',')[0].trim();
  return crypto
    .createHash('sha256')
    .update(ip + (process.env.TOKEN_SECRET || ''))
    .digest('hex')
    .slice(0, 32);
}

// Identifiant aléatoire généré par le navigateur (facultatif).
export function idAppareil(req) {
  const v = String(req.headers['x-device-id'] || '');
  return /^[a-zA-Z0-9-]{16,64}$/.test(v) ? v : null;
}

/* ================= 3. Base de données (Upstash Redis via REST) ================= */

export async function redis(...commande) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Base de données Redis non configurée');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commande)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Compteur qui expire tout seul : +1 à chaque appel, remis à zéro après ttlSecondes.
export async function compter(cle, ttlSecondes) {
  const n = await redis('INCR', cle);
  if (n === 1) await redis('EXPIRE', cle, ttlSecondes);
  return n;
}

// Limite de débit : renvoie false si "max" appels sont dépassés dans la fenêtre.
export async function limiter(cle, max, fenetreSecondes) {
  return (await compter(`rl:${cle}`, fenetreSecondes)) <= max;
}

/* ================= 4. Jetons signés ================= */
// Un jeton = données + signature HMAC. Sans TOKEN_SECRET, impossible d'en fabriquer un valide.

function secret() {
  if (!process.env.TOKEN_SECRET) throw new Error('TOKEN_SECRET manquant');
  return process.env.TOKEN_SECRET;
}

function signature(donnees) {
  return crypto.createHmac('sha256', secret()).update(donnees).digest('base64url');
}

export function signerToken(payload) {
  const corps = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${corps}.${signature(corps)}`;
}

export function lireToken(token) {
  if (typeof token !== 'string' || token.length > 500) return null;
  const [corps, sig] = token.split('.');
  if (!corps || !sig) return null;
  const attendu = Buffer.from(signature(corps));
  const recu = Buffer.from(sig);
  if (attendu.length !== recu.length || !crypto.timingSafeEqual(attendu, recu)) return null;
  try {
    return JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Le jeton prouve "ce pass existe" ; Redis dit s'il est encore valable (non expiré, non résilié).
export async function lireAcces(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  const jeton = lireToken(auth.slice(7));
  if (!jeton || typeof jeton.sid !== 'string') return null;
  const brut = await redis('GET', `pass:${jeton.sid}`);
  if (!brut) return null;
  const pass = JSON.parse(brut);
  if (pass.exp && Date.now() > pass.exp) return null;
  return { sid: jeton.sid, plan: pass.plan };
}

/* ================= 5. Stripe ================= */

export async function stripe(methode, chemin, params) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY manquant');
  let url = `https://api.stripe.com/v1${chemin}`;
  const options = { method: methode, headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } };
  if (params) {
    const corps = new URLSearchParams(params);
    if (methode === 'GET') {
      url += `?${corps}`;
    } else {
      options.body = corps;
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  const r = await fetch(url, options);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Erreur Stripe (${r.status})`);
  return j;
}

// On demande TOUJOURS à Stripe si la session est payée : on ne croit jamais le navigateur.
export async function activerSession(sid) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return null;
  const s = await stripe('GET', `/checkout/sessions/${sid}`);
  if (s.payment_status !== 'paid') return null;
  if (s.metadata?.app !== 'dossierblinde') return null;

  const plan = s.mode === 'subscription' ? 'mensuel' : 'unique';
  const pass = { plan, exp: plan === 'unique' ? Date.now() + 14 * 86400000 : null };

  // NX = ne rien écraser si le pass existe déjà (évite de prolonger un pass "unique").
  const args = ['SET', `pass:${sid}`, JSON.stringify(pass)];
  if (pass.exp) args.push('EX', 15 * 86400);
  args.push('NX');
  await redis(...args);

  if (plan === 'mensuel' && s.subscription) {
    await redis('SET', `sub:${s.subscription}`, sid);
  }
  return { sid, plan };
}

// Vérifie que le webhook vient bien de Stripe (signature HMAC du corps brut).
export function verifierSignatureStripe(corpsBrut, enTete, secretWebhook, toleranceSec = 300) {
  if (!enTete || !secretWebhook) return false;
  let t = null;
  const signatures = [];
  for (const morceau of String(enTete).split(',')) {
    const [k, v] = morceau.split('=');
    if (k === 't') t = v;
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!t || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

  const attendu = crypto
    .createHmac('sha256', secretWebhook)
    .update(Buffer.concat([Buffer.from(`${t}.`), corpsBrut]))
    .digest('hex');

  return signatures.some(
    (s) => s.length === attendu.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(attendu))
  );
}

