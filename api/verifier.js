export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Méthode non autorisée' });
    }

    try {
        const { imageBase64, documentAttendu } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'Clé API non configurée sur Vercel' });
        }

        const base64Data = imageBase64.split(',')[1];

        const prompt = `Tu es un contrôleur administratif strict et bienveillant en France.
Le client doit fournir ce document : "${documentAttendu}".
Analyse cette image et réponds UNIQUEMENT au format JSON strict suivant (sans balises markdown) :
{
  "valide": true ou false,
  "message": "Une phrase courte et claire en français (ex: 'Facture EDF conforme datée de moins de 3 mois' ou 'Document illisible / ne correspond pas à une pièce d'identité')."
}
Règles :
1. Vérifie que le document correspond bien à "${documentAttendu}".
2. Vérifie qu'il est lisible (pas trop flou ni coupé).
3. Si c'est un justificatif de domicile ou bulletin de salaire, vérifie que la date est récente (en 2026). Si c'est une pièce d'identité, vérifie qu'elle n'est pas expirée.`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
        const texteReponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonClean = texteReponse.replace(/```json|```/g, '').trim();
        const resultat = JSON.parse(jsonClean);

        return res.status(200).json(resultat);

    } catch (error) {
        return res.status(500).json({ 
            valide: false, 
            message: "Impossible d'analyser l'image. Vérifiez la netteté et réessayez." 
        });
    }
}
