export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ valide: false, message: 'Méthode non autorisée' });
    }

    try {
        const { imageBase64, documentAttendu } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(200).json({ 
                valide: false, 
                message: "Clé API absente : redéployez le projet sur Vercel." 
            });
        }

        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(200).json({ 
                valide: false, 
                message: "Format d'image non reconnu. Essayez une photo JPG ou PNG." 
            });
        }

        const base64Data = imageBase64.split(',')[1];

        // 1. Récupérer dynamiquement les modèles actifs compatibles sur cette clé API
        let modelesActifs = ['gemini-3.8-flash'];
        try {
            const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (listRes.ok) {
                const listData = await listRes.json();
                const compatibles = (listData.models || [])
                    .filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('flash'))
                    .map(m => m.name.replace('models/', ''));
                if (compatibles.length > 0) {
                    modelesActifs = compatibles;
                }
            }
        } catch (e) {
            // Garde gemini-3.8-flash par défaut si ListModels échoue
        }

        const prompt = `Tu es un contrôleur administratif en France.
Le client doit fournir ce document : "${documentAttendu}".
Analyse cette image et réponds en JSON avec deux clés : "valide" (booleen true ou false) et "message" (une phrase courte et claire en français expliquant le verdict).
Règles :
1. Vérifie que le document correspond bien à "${documentAttendu}".
2. Vérifie qu'il est globalement lisible.
3. Si c'est un justificatif de domicile, bulletin de salaire ou relevé URSSAF, vérifie qu'il est récent (année 2026). Si c'est une pièce d'identité, vérifie qu'elle n'est pas expirée.`;

        let data = null;
        let succes = false;
        let derniereErreur = "";

        // 2. Tester les modèles actifs disponibles avec 1 tentative de relance si pic de trafic
        for (const modele of modelesActifs) {
            for (let essai = 0; essai < 2; essai++) {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
                            ]
                        }],
                        generationConfig: {
                            responseMimeType: "application/json"
                        }
                    })
                });

                data = await response.json();

                if (response.ok) {
                    succes = true;
                    break;
                }

                derniereErreur = data?.error?.message || "Erreur IA";

                // Si surcharge temporaire (503/429), on attend 1,5 seconde puis on réessaie ou passe au modèle suivant
                if (response.status === 503 || response.status === 429) {
                    await new Promise(r => setTimeout(r, 1500));
                } else {
                    break;
                }
            }
            if (succes) break;
        }

        if (!succes) {
            if (derniereErreur.includes("high demand") || derniereErreur.includes("overloaded")) {
                return res.status(200).json({
                    valide: false,
                    message: "Serveur IA très sollicité à l'instant. Appuyez sur Refaire dans 5 secondes."
                });
            }
            return res.status(200).json({ 
                valide: false, 
                message: `Erreur IA : ${derniereErreur}` 
            });
        }

        const texteReponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const resultat = JSON.parse(texteReponse);

        return res.status(200).json({
            valide: Boolean(resultat.valide),
            message: resultat.message || (resultat.valide ? "Document conforme." : "Document non conforme.")
        });

    } catch (error) {
        return res.status(200).json({ 
            valide: false, 
            message: `Erreur technique : ${error.message}` 
        });
    }
}



