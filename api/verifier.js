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
            promptTexte = `Tu es un assistant administratif français expert et bienveillant.
Analyse la demande ou le courrier ci-joint : "${descriptionSituation || ''}".
Réponds UNIQUEMENT au format JSON strict (sans balises markdown) avec cette structure exacte :
{
  "ok": true,
  "resume": "Explication claire en 2 phrases simples de ce qui est demandé",
  "pieces": [
    { "id": "identifiant_unique", "titre": "Nom exact du papier demandé", "info": "Précision utile (ex: moins de 3 mois, recto-verso)", "couleur": false }
  ],
  "reponse_type": "Modèle de courrier ou message court prêt à envoyer si une réponse écrite est utile, sinon chaîne vide"
}`;
        } else {
            promptTexte = `Tu es un contrôleur de dossiers administratifs français.
Document attendu : "${documentAttendu || 'Document officiel'}" (dans le cadre de : ${contexteDossier || 'démarche administrative'}).
Vérifie sur la photo :
1. Est-ce bien le bon type de document ?
2. Le document est-il net, lisible, complet et non coupé ?
Réponds UNIQUEMENT au format JSON strict (sans balises markdown) :
{
  "valide": true ou false,
  "message": "Message très court et clair pour l'utilisateur (ex: 'Carte d'identité recto nette et validée' ou 'Photo floue ou bord coupé, merci de reprendre la photo')"
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

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.2
                    }
                })
            }
        );

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
