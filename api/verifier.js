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

        const prompt = `Contrôleur administratif français. Document attendu : "${documentAttendu}".
Réponds UNIQUEMENT en JSON : {"valide": true, "message": "Court verdict en français (max 12 mots)"}
Si le document correspond à "${documentAttendu}" et est lisible (photo ou capture d'écran officielle), mets "valide": true. Sinon false.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(25000),
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
                    ]
                }],
                generationConfig: {
                    maxOutputTokens: 120,
                    temperature: 0.1
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            const errMsg = data?.error?.message || "Service IA momentanément saturé";
            return res.status(200).json({ 
                valide: false, 
                message: `IA occupée : ${errMsg}` 
            });
        }

        const texteBrut = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const matchJson = texteBrut.match(/\{[\s\S]*\}/);

        if (!matchJson) {
            return res.status(200).json({ 
                valide: false, 
                message: "Réponse IA incomplète, appuyez sur Refaire." 
            });
        }

        const resultat = JSON.parse(matchJson[0]);

        return res.status(200).json({
            valide: Boolean(resultat.valide),
            message: resultat.message || (resultat.valide ? "Document conforme." : "Document non conforme.")
        });

    } catch (error) {
        if (error.name === 'TimeoutError') {
            return res.status(200).json({ 
                valide: false, 
                message: "Serveur Google trop lent. Appuyez sur Refaire." 
            });
        }
        return res.status(200).json({ 
            valide: false, 
            message: `Erreur technique : ${error.message}` 
        });
    }
}






