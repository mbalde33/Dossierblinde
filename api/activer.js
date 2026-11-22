// api/activer.js — après le paiement, échange l'identifiant de session Stripe contre un jeton signé
import {
  repondre, lireJson, empreinteClient, limiter, compter, activerSession, signerToken
} from '../lib/core.js';

const MAX_APPAREILS = 5; // un même paiement ne peut pas être activé partout

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return repondre(res, 405, { ok: false, message: 'Méthode non autorisée' });
  }
  try {
    const ip = empreinteClient(req);
    if (!(await limiter(`activer:${ip}`, 10, 3600))) {
      return repondre(res, 429, { ok: false, message: 'Trop de tentatives. Réessayez plus tard.' });
    }

    const sid = String(lireJson(req).session_id || '');
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) {
      return repondre(res, 400, { ok: false, message: 'Identifiant de paiement invalide.' });
    }

    // Stripe est la seule source de vérité : est-ce vraiment payé ?
    const pass = await activerSession(sid);
    if (!pass) {
      return repondre(res, 402, { ok: false, message: 'Paiement introuvable ou pas encore confirmé.' });
    }

    if ((await compter(`act:${sid}`, 30 * 86400)) > MAX_APPAREILS) {
      return repondre(res, 429, { ok: false, message: 'Ce paiement a déjà été activé sur trop d\'appareils.' });
    }

    return repondre(res, 200, { ok: true, plan: pass.plan, token: signerToken({ sid: pass.sid, plan: pass.plan }) });
  } catch (e) {
    console.error('activer:', e.message);
    return repondre(res, 500, { ok: false, message: 'Activation impossible pour le moment.' });
  }
}

