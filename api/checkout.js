// api/checkout.js — crée une page de paiement Stripe pour l'offre choisie
import { repondre, lireJson, empreinteClient, limiter, stripe } from '../lib/core.js';

// Le navigateur choisit seulement "unique" ou "mensuel" : le prix vient toujours du serveur.
const OFFRES = {
  unique: { mode: 'payment', prix: () => process.env.STRIPE_PRICE_UNIQUE },
  mensuel: { mode: 'subscription', prix: () => process.env.STRIPE_PRICE_MENSUEL }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return repondre(res, 405, { ok: false, message: 'Méthode non autorisée' });
  }
  try {
    const ip = empreinteClient(req);
    if (!(await limiter(`checkout:${ip}`, 10, 3600))) {
      return repondre(res, 429, { ok: false, message: 'Trop de tentatives. Réessayez plus tard.' });
    }

    const { offre, renonciation } = lireJson(req);
    const o = OFFRES[offre];
    if (!o) return repondre(res, 400, { ok: false, message: 'Offre inconnue.' });
    // Contenu numérique fourni immédiatement : l'accord de l'acheteur est obligatoire (art. L221-28 13° Code conso)
    if (renonciation !== true) {
      return repondre(res, 400, { ok: false, message: 'Cochez la case d\'accord avant de payer.' });
    }

    const site = (process.env.SITE_URL || '').replace(/\/$/, '');
    const prix = o.prix();
    if (!site || !prix) return repondre(res, 500, { ok: false, message: 'Paiement non configuré.' });

    const session = await stripe('POST', '/checkout/sessions', {
      mode: o.mode,
      'line_items[0][price]': prix,
      'line_items[0][quantity]': '1',
      success_url: `${site}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/?paiement=annule`,
      locale: 'fr',
      'metadata[app]': 'dossierblinde',
      'metadata[offre]': offre,
      'metadata[renonciation_retractation]': 'oui',
      'metadata[date_accord]': new Date().toISOString()
    });

    return repondre(res, 200, { ok: true, url: session.url });
  } catch (e) {
    console.error('checkout:', e.message);
    return repondre(res, 500, { ok: false, message: 'Impossible de lancer le paiement.' });
  }
}
