export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb'
        }
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, message: 'Méthode non autorisée' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({
            valide: false,
            ok: false,
            message: "ERREUR CONFIGURATION : Clé GEMINI_API_KEY manquante sur Vercel. Impossible de vérifier le document."
        });
    }

    try {
        const { mode, imageBase64, documentAttendu, contexteDossier, descriptionSituation } = req.body || {};

        // MODE 1 : LECTEUR DE COURRIER RECU & RECHERCHE DE DEMARCHE
        if (mode === 'diagnostic') {
            const promptDiagnostic = `Tu es un expert administratif français intraitable.
Situation ou demande de l'utilisateur : "${descriptionSituation || 'Analyse du courrier joint'}".

Analyse attentivement le texte et l'image (si fournie) et réponds STRICTEMENT au format JSON suivant sans aucun texte autour :
{
  "ok": true,
  "resume": "Explication claire en 2 phrases maximum des documents exacts demandés par l'organisme.",
  "pieces": [
    {
      "id": "identifiant_court",
      "titre": "Nom exact du document à fournir",
      "info": "Condition précise (date, format, signature, organisme émetteur)",
      "format": "a4",
      "couleur": false
    }
  ],
  "reponse_type": "Courrier officiel court et poli prêt à envoyer pour accompagner les pièces (ou chaîne vide si simple recherche de dossier)."
}`;

            const parts = [{ text: promptDiagnostic }];
            if (imageBase64 && imageBase64.includes(',')) {
                const [meta, base64Data] = imageBase64.split(',');
                const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';
                parts.push({ inlineData: { mimeType, data: base64Data } });
            }

            const reponseGemini = await appelerGemini(apiKey, parts);
            return res.status(200).json(reponseGemini);
        }

        // MODE 2 : CONTROLE STRICT ZÉRO TOLÉRANCE D'UN DOCUMENT SCANNÉ
        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(400).json({
                valide: false,
                message: "Aucune image reçue. Veuillez reprendre la photo."
            });
        }

        const [meta, base64Data] = imageBase64.split(',');
        const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';

        const promptVerification = `Tu es un agent administratif français EXTRÊMEMENT STRICT chargé de rejeter tout dossier qui risquerait d'être refusé par une préfecture, une banque, la CAF ou un bailleur.

Document attendu : "${documentAttendu}"
Dossier concerné : "${contexteDossier || 'Dossier administratif'}"

RÈGLES DE REJET OBLIGATOIRES (valide = false dès la MOINDRE anomalie) :
1. CADRAGE ET BORDS COUPÉS : Si un seul coin, bord, ligne de texte, bande MRZ ou photo d'identité est coupé ou sort du cadre -> REFUSER IMMEDIATEMENT.
2. NETTETÉ ET LUMINOSITÉ : Si la photo est floue, sombre, surexposée, avec un reflet de flash sur les écritures ou un doigt qui cache une zone -> REFUSER IMMEDIATEMENT.
3. IDENTITÉ DU DOCUMENT : Si l'image ne correspond pas EXACTEMENT au document demandé ("${documentAttendu}") ou si c'est le verso au lieu du recto (ou inversement) -> REFUSER IMMEDIATEMENT.
4. LISIBILITÉ DES INFORMATIONS CLÉS : Tous les noms, prénoms, dates de naissance, dates d'émission, numéros et adresses doivent être 100 % lisibles sans effort. Si un seul chiffre ou mot est illisible -> REFUSER IMMEDIATEMENT.
5. VALIDITÉ ET DATE : Pour un justificatif de domicile, vérifier la date (moins de 3 mois). Pour une pièce d'identité, vérifier qu'elle n'est pas visiblement périmée.

Réponds STRICTEMENT en JSON valide (aucun markdown, aucun texte autour) :
{
  "valide": true ou false,
  "message": "Si valide=true : confirmation courte et précise (ex: 'CNI recto parfaitement nette et complète'). Si valide=false : explication directe et précise de l'erreur constatée et comment corriger (ex: 'Refusé : le haut de la carte est coupé et le texte est flou. Reculez le téléphone à la lumière.').",
  "pieces_manquantes": []
}`;

        const resultat = await appelerGemini(apiKey, [
            { text: promptVerification },
            { inlineData: { mimeType, data: base64Data } }
        ]);

        return res.status(200).json({
            valide: Boolean(resultat.valide),
            message: resultat.message || (resultat.valide ? "Document conforme et net." : "Document refusé : qualité ou cadrage insuffisant."),
            pieces_manquantes: Array.isArray(resultat.pieces_manquantes) ? resultat.pieces_manquantes : []
        });

    } catch (erreur) {
        return res.status(500).json({
            valide: false,
            ok: false,
            message: "Échec du contrôle IA (" + erreur.message + "). Veuillez réessayer."
        });
    }
}

async function appelerGemini(apiKey, parts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json"
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || `Erreur API Gemini ${response.status}`);
    }

    const texteBrut = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const jsonNettoye = texteBrut.replace(/```json|```/g, '').trim();
    return JSON.parse(jsonNettoye);
}





