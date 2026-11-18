export const maxDuration = 60;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ valide: false, message: 'Méthode non autorisée' });
    }

    try {
        const { imageBase64, documentAttendu } = req.body;
        const geminiKey = process.env.GEMINI_API_KEY;
        const groqKey = process.env.GROQ_API_KEY;

        if (!geminiKey && !groqKey) {
            return res.status(200).json({ 
                valide: false, 
                message: "Clé API IA manquante sur Vercel." 
            });
        }

        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(200).json({ 
                valide: false, 
                message: "Fichier image invalide." 
            });
        }

        const base64Data = imageBase64.split(',')[1];

        if (base64Data.length < 4000) {
            return res.status(200).json({
                valide: false,
                message: "Image trop petite ou floue, rescannez le document."
            });
        }

        const prompt = `Tu es un contrôleur administratif français strict mais juste.
Date du jour : 18 novembre 2026 (les documents datés de fin 2026 sont récents et valides).
Document attendu : "${documentAttendu}".

Analyse attentivement l'image et réponds UNIQUEMENT par un objet JSON valide :
{"valide": true, "message": "Explication courte en français (max 12 mots)"}

Règles strictes :
1. Vérifie d'abord la NATURE du document : s'il s'agit d'un objet, d'un selfie, d'un écran noir, ou d'un AUTRE document que "${documentAttendu}" (ex: une facture à la place d'une CNI, un recto à la place d'un verso, un RIB à la place d'un avis d'imposition), mets OBLIGATOIREMENT "valide": false et dis quel document tu vois réellement.
2. Si c'est bien "${documentAttendu}" et que les informations clés sont lisibles, mets "valide": true.
3. Pour un justificatif de domicile, bulletin de salaire ou relevé URSSAF : accepte tout document daté d'août, septembre, octobre ou novembre 2026.`;

        let derniereErreur = "Serveurs IA occupés";

        // 1. Google Gemini (modèles stables avec 18s de délai)
        if (geminiKey) {
            const modeles = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
            for (const modele of modeles) {
                try {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${geminiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(18000),
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
                    if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                        const texteBrut = data.candidates[0].content.parts[0].text;
                        const matchJson = texteBrut.match(/\{[\s\S]*\}/);
                        if (matchJson) {
                            const resultat = JSON.parse(matchJson[0]);
                            return res.status(200).json({
                                valide: Boolean(resultat.valide),
                                message: resultat.message || (resultat.valide ? "Document conforme." : "Document non conforme.")
                            });
                        }
                    } else {
                        derniereErreur = data?.error?.message || `Erreur HTTP ${response.status}`;
                    }
                } catch (e) {
                    derniereErreur = e.name === 'TimeoutError' ? "Délai IA dépassé" : e.message;
                }
            }
        }

        // 2. Bascule sur Groq Vision si configuré
        if (groqKey) {
            try {
                const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqKey}`,
                        'Content-Type': 'application/json'
                    },
                    signal: AbortSignal.timeout(15000),
                    body: JSON.stringify({
                        model: 'llama-3.2-11b-vision-preview',
                        temperature: 0.1,
                        max_tokens: 120,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: imageBase64 } }
                            ]
                        }]
                    })
                });

                const groqData = await groqResp.json();
                const texteGroq = groqData.choices?.[0]?.message?.content || '';
                const matchJson = texteGroq.match(/\{[\s\S]*\}/);
                if (matchJson) {
                    const resultat = JSON.parse(matchJson[0]);
                    return res.status(200).json({
                        valide: Boolean(resultat.valide),
                        message: resultat.message || (resultat.valide ? "Document conforme." : "Document non conforme.")
                    });
                }
            } catch (e) {
                derniereErreur = e.message;
            }
        }

        // Aucun secours aveugle : on refuse tant que l'IA n'a pas pu vérifier le document
        return res.status(200).json({
            valide: false,
            message: `Vérification IA impossible (${derniereErreur}). Appuyez sur Rescanner.`
        });

    } catch (error) {
        return res.status(200).json({ 
            valide: false, 
            message: `Erreur technique : ${error.message}` 
        });
    }
}








