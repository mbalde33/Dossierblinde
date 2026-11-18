export const maxDuration = 60;

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
                message: "Clé API absente sur Vercel." 
            });
        }

        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(200).json({ 
                valide: false, 
                message: "Image invalide." 
            });
        }

        const base64Data = imageBase64.split(',')[1];

        const prompt = `Tu es un contrôleur administratif français pragmatique.
Date : 18 novembre 2026 (les documents datés de fin 2026 sont récents et valides).
Document attendu : "${documentAttendu}".

Réponds UNIQUEMENT en JSON : {"valide": true, "message": "Verdict court en français (max 10 mots)"}

Règles :
1. Si le document correspond à "${documentAttendu}" et est lisible, mets "valide": true.
2. Verso pièce d'identité : dès que la face arrière est visible et lisible, mets "valide": true sans bloquer sur l'arrière-plan.
3. Justificatif de domicile, bulletin de salaire ou URSSAF : accepte tout document daté d'août, septembre, octobre ou novembre 2026.
4. Mets "valide": false uniquement si mauvais document ou totalement illisible.`;

        const modeles = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
        let texteBrut = "";
        let succes = false;
        let derniereErreur = "";

        for (const modele of modeles) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(15000),
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
                            ]
                        }],
                        generationConfig: {
                            maxOutputTokens: 100,
                            temperature: 0.1,
                            thinkingConfig: { thinkingBudget: 0 }
                        }
                    })
                });

                const data = await response.json();

                if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    texteBrut = data.candidates[0].content.parts[0].text;
                    succes = true;
                    break;
                }
                derniereErreur = data?.error?.message || "Serveur IA occupé";
            } catch (e) {
                derniereErreur = e.name === 'TimeoutError' ? "Délai dépassé" : e.message;
            }
        }

        if (!succes) {
            return res.status(200).json({ 
                valide: false, 
                message: `IA saturée (${derniereErreur}). Appuyez sur Refaire.` 
            });
        }

        const matchJson = texteBrut.match(/\{[\s\S]*\}/);
        if (!matchJson) {
            return res.status(200).json({ 
                valide: false, 
                message: "Lecture IA incomplète, appuyez sur Refaire." 
            });
        }

        const resultat = JSON.parse(matchJson[0]);

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







