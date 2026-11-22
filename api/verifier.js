export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, message: 'Méthode non autorisée' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            ok: false,
            message: 'Clé GEMINI_API_KEY manquante sur Vercel.'
        });
    }

    try {
        const { mode, imageBase64, documentAttendu, contexteDossier, descriptionSituation, villeOuCp } = req.body || {};

        let promptTexte = '';
        if (mode === 'destination') {
            promptTexte = `Tu es un conseiller administratif français expert de Service-Public.fr.
Démarche de l'usager : "${contexteDossier || ''}".
Code postal ou ville de l'usager : "${villeOuCp || 'France entière'}".

Donne les instructions EXACTES et CONCRÈTES pour envoyer ou déposer ce dossier en France :
1. Nom court de l'organisme destinataire (pour mettre sur le filigrane de protection, ex: "BANQUE DE FRANCE RHÔNE" ou "PRÉFECTURE DU RHÔNE" ou "CAF").
2. Canal d'envoi officiel (en ligne sur quel portail précis en .gouv.fr / .fr, ou par courrier recommandé AR, ou sur place sur rendez-vous).
3. Adresse postale exacte du guichet ou service compétent pour la ville/code postal "${villeOuCp || ''}" (si applicable) et site web officiel exact.
4. Conseil pratique en 1 phrase pour que l'envoi soit pris en compte immédiatement.

Réponds UNIQUEMENT au format JSON strict (sans balises markdown) :
{
  "ok": true,
  "destinataire_filigrane": "NOM COURT DE L'ORGANISME EN MAJUSCULES",
  "mode_envoi": "En ligne / Courrier recommandé AR / Sur place",
  "site_officiel": "Nom et adresse du site officiel (ex: banque-france.fr ou ants.gouv.fr)",
  "adresse_postale": "Adresse postale précise de l'organisme local ou mention 'Démarche 100 % en ligne'",
  "consigne": "Explication claire en 2 phrases simples de la marche à suivre pour envoyer le PDF"
}`;
        } else if (mode === 'diagnostic') {
            promptTexte = `Tu es le meilleur expert juriste et spécialiste des démarches administratives en France (Service-Public.fr, Préfectures, ANTS, CAF, CPAM, Impôts, Banque de France, Tribunaux, Urssaf, Notaires).
Demande ou courrier de l'usager : "${descriptionSituation || ''}".

MISSION CRITIQUE :
Tu dois fournir la liste EXHAUSTIVE, OFFICIELLE ET SANS AUCUNE FAUTE de TOUTES les pièces justificatives obligatoires pour que ce dossier en France soit accepté du premier coup, même s'il s'agit d'une démarche très complexe, rare ou pointue.
Règles strictes :
1. N'oublie JAMAIS les pièces de base (pièce d'identité en cours de validité, justificatif de domicile de moins de 3 ou 6 mois, etc.) NI les pièces techniques spécifiques (numéro exact du formulaire Cerfa s'il existe, acte d'état civil en copie intégrale, traduction par traducteur assermenté si document étranger, timbre fiscal, avis d'imposition, RIB, Kbis, etc.).
2. Dans le champ "info" de chaque pièce, précise la règle exacte pour éviter tout rejet (ex: "Moins de 3 mois", "Copie intégrale et non extrait", "Formulaire Cerfa n°... signé", "Recto-verso").
3. Indique aussi clairement où et comment déposer ce dossier (site officiel et type d'organisme destinataire).
4. Si un courrier est joint, explique clairement ce que l'organisme demande et rédige une réponse officielle prête à envoyer.

Réponds UNIQUEMENT au format JSON strict (sans balises markdown) avec cette structure exacte :
{
  "ok": true,
  "resume": "Explication claire et rassurante en 2 phrases de la démarche et des points de vigilance pour ne pas être recalé",
  "ou_envoyer": "Où et comment déposer ce dossier (site officiel précis ou organisme compétent)",
  "destinataire_suggere": "NOM DE L'ORGANISME EN MAJUSCULES",
  "pieces": [
    {
      "id": "identifiant_unique_sans_espace",
      "titre": "Nom exact et officiel du document ou formulaire Cerfa demandé",
      "info": "Condition stricte de validité (ex: moins de 3 mois, signé, traduction assermentée)",
      "couleur": false
    }
  ],
  "reponse_type": "Modèle de courrier ou message officiel prêt à envoyer si une réponse écrite est utile, sinon chaîne vide"
}`;
        } else {
            promptTexte = `Tu es un contrôleur officiel de dossiers administratifs français exigeant et bienveillant.
Document attendu : "${documentAttendu || 'Document officiel'}" (dans le cadre de : ${contexteDossier || 'démarche administrative'}).
Vérifie attentivement sur l'image :
1. Est-ce bien le bon type de document correspondant à "${documentAttendu || 'Document officiel'}" ?
2. Le document est-il net, entièrement lisible, complet et sans bord coupé ni reflet masquant les informations clés ?
Réponds UNIQUEMENT au format JSON strict (sans balises markdown) :
{
  "valide": true ou false,
  "message": "Message très court et clair pour l'utilisateur (ex: 'Document conforme, net et validé' ou 'Document illisible ou non conforme, merci de reprendre la photo')"
}`;
        }

        const parts = [{ text: promptTexte }];

        if (imageBase64 && typeof imageBase64 === 'string') {
            const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
            if (match) {
                parts.push({
                    inlineData: {
                        mimeType: match[1],
                        data: match[2]
                    }
                });
            }
        }

        const optionsRequete = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.15
                }
            })
        };

        let response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
            optionsRequete
        );

        if (response.status === 503 || response.status === 429) {
            response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
                optionsRequete
            );
        }

        const data = await response.json();

        if (!response.ok) {
            const errMsg = data?.error?.message || `Erreur API Gemini (${response.status})`;
            return res.status(502).json({ ok: false, valide: false, message: errMsg });
        }

        const texteBrut = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const texteNettoye = texteBrut.replace(/```json\s*|```\s*/g, '').trim();
        const resultatJson = JSON.parse(texteNettoye);

        return res.status(200).json({ ok: true, ...resultatJson });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            valide: false,
            message: 'Erreur serveur lors de la vérification : ' + error.message
        });
    }
}
