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

        const prompt = `Tu es un vérificateur de documents administratifs français.
Document attendu : "${documentAttendu}".
Analyse cette image et réponds UNIQUEMENT par un objet JSON valide (sans texte autour, sans markdown) :
{"valide": true, "message": "Explication courte en français"}

Règles de contrôle :
- Si l'image correspond bien au type de document demandé ("${documentAttendu}") et que le texte principal est lisible, mets "valide": true.
- Si c'est un autre type de document (ex: une facture à la place d'une carte d'identité), un objet quelconque ou totalement illisible, mets "valide": false et explique pourquoi en une phrase courte.
- Sois pragmatique : accepte les captures d'écran de documents officiels (URSSAF, impôts, factures numériques, photos de CNI recto ou verso).`;

        const modeles = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
        let texteBrut = "";
        let succes = false;
        let derniereErreur = "";

        for (const modele of modeles) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
                        ]
                    }]
                })
            });

            const data = await response.json();

            if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                texteBrut = data.candidates[0].content.parts[0].text;
                succes = true;
                break;
            }
            derniereErreur = data?.error?.message || "Réponse vide de l'IA";
        }

        if (!succes) {
            return res.status(200).json({ 
                valide: false, 
                message: `Erreur IA : ${derniereErreur}` 
            });
        }

        const matchJson = texteBrut.match(/\{[\s\S]*\}/);
        if (!matchJson) {
            return res.status(200).json({ 
                valide: false, 
                message: "Lecture IA incomplète, réessayez." 
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





