// api/webhook.js — Stripe prévient ton serveur (paiement réussi, abonnement résilié)
import { redis, activerSession, verifierSignatureStripe } from '../lib/core.js';

// On a besoin du corps EXACT envoyé par Stripe pour vérifier la signature :
// on désactive donc l'analyse automatique et on ne touche jamais à req.body.
export const config = { api: { bodyParser: false } };

async function lireCorpsBrut(req) {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  return Buffer.concat(morceaux);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secretWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretWebhook) return res.status(500).json({ ok: false });

  const brut = await lireCorpsBrut(req);
  if (!verifierSignatureStripe(brut, req.headers['stripe-signature'], secretWebhook)) {
    return res.status(400).json({ ok: false, message: 'Signature invalide' });
  }

  let evenement;
  try {
    evenement = JSON.parse(brut.toString('utf8'));
  } catch {
    return res.status(400).json({ ok: false });
  }

  try {
    const objet = evenement.data?.object;

    if (
      evenement.type === 'checkout.session.completed' ||
      evenement.type === 'checkout.session.async_payment_succeeded'
    ) {
      await activerSession(objet.id); // revérifie auprès de Stripe puis enregistre le pass
    } else if (evenement.type === 'customer.subscription.deleted') {
      const sid = await redis('GET', `sub:${objet.id}`);
      if (sid) await redis('DEL', `pass:${sid}`); // abonnement résilié : le pass s'arrête
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('webhook:', evenement.type, e.message);
    return res.status(500).json({ ok: false }); // Stripe réessaiera automatiquement
  }
}

