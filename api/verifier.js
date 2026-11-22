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
        const { mode, imageBase64, documentAttendu, contexteDossier, descriptionSituation } = req.body || {};

        let promptTexte = '';
        if (mode === 'diagnostic') {
            promptTexte = `Tu es le meilleur expert juriste et spécialiste des démarches administratives en France (Service-Public.fr, Préfectures, ANTS, CAF, CPAM, Impôts, Banque de France, Tribunaux, Urssaf, Notaires).
Demande ou courrier de l'usager : "${descriptionSituation || ''}".

MISSION CRITIQUE :
Tu dois fournir la liste EXHAUSTIVE, OFFICIELLE ET SANS AUCUNE FAUTE de TOUTES les pièces justificatives obligatoires pour que ce dossier en France soit accepté du premier coup, même s'il s'agit d'une démarche très complexe, rare ou pointue.
Règles strictes :
1. N'oublie JAMAIS les pièces de base (pièce d'identité en cours de validité, justificatif de domicile de moins de 3 ou 6 mois, etc.) NI les pièces techniques spécifiques (numéro exact du formulaire Cerfa s'il existe, acte d'état civil en copie intégrale, traduction par traducteur assermenté si document étranger, timbre fiscal, avis d'imposition, RIB, Kbis, etc.).
2. Dans le champ "info" de chaque pièce, précise la règle exacte pour éviter tout rejet (ex: "Moins de 3 mois", "Copie intégrale et non extrait", "Formulaire Cerfa n°... signé", "Recto-verso").
3. Si un courrier est joint, explique clairement ce que l'organisme demande et rédige une réponse officielle prête à envoyer.

Réponds UNIQUEMENT au format JSON strict (sans balises markdown) avec cette structure exacte :
{
  "ok": true,
  "resume": "Explication claire et rassurante en 2 phrases de la démarche et des points de vigilance pour ne pas être recalé",
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
