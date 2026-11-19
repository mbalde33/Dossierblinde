export const maxDuration = 60;

function nettoyerEtParserJSON(texteBrut) {
    if (!texteBrut) return null;
    const sansMarkdown = texteBrut.replace(/```json/gi, '').replace(/```/g, '').trim();
    const matchJson = sansMarkdown.match(/\{[\s\S]*\}/);
    if (!matchJson) return null;
    try {
        return JSON.parse(matchJson[0]);
    } catch (e) {
        // Nettoyage des virgules trainantes eventuelles avant } ou ]
        const nettoye = matchJson[0].replace(/,\s*([}\]])/g, '$1');
        try {
            return JSON.parse(nettoye);
        } catch (e2) {
            return null;
        }
    }
}

async function appelerCascadeIA(prompt, imageBase64, geminiKey, groqKey) {
    let derniereErreur = "Serveurs IA temporairement occupés";

    // 1. Cascade sur tous les modèles Gemini disponibles (avec bascule automatique en cas de "high demand")
    if (geminiKey && geminiKey.trim().length > 10) {
        const modeles = [
            'gemini-3.5-flash-lite',
            'gemini-3.5-flash',
            'gemini-2.5-flash',
            'gemini-3.5-flash-lite'
        ];

        for (let i = 0; i < modeles.length; i++) {
            const modele = modeles[i];
            try {
                if (i > 0) {
                    await new Promise(r => setTimeout(r, 700));
                }

                const parts = [{ text: prompt }];
                if (imageBase64 && imageBase64.includes(',')) {
                    parts.push({
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: imageBase64.split(',')[1]
                        }
                    });
                }

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${geminiKey.trim()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(16000),
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            maxOutputTokens: 2500,
                            temperature: 0.1
                        }
                    })
                });

                const data = await response.json();
                if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const parsed = nettoyerEtParserJSON(data.candidates[0].content.parts[0].text);
                    if (parsed) {
                        return { ok: true, data: parsed };
                    }
                } else {
                    derniereErreur = data?.error?.message || `HTTP ${response.status}`;
                }
            } catch (e) {
                derniereErreur = e.name === 'TimeoutError' ? "Délai dépassé" : e.message;
            }
        }
    }

    // 2. Bascule automatique sur Groq si configuré
    if (groqKey && groqKey.trim().length > 10) {
        try {
            const isVision = Boolean(imageBase64 && imageBase64.includes(','));
            const content = isVision
                ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageBase64 } }]
                : prompt;

            const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(16000),
                body: JSON.stringify({
                    model: isVision ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile',
                    temperature: 0.1,
                    max_tokens: 2000,
                    messages: [{ role: 'user', content }]
                })
            });

            const groqData = await groqResp.json();
            if (groqResp.ok && groqData.choices?.[0]?.message?.content) {
                const parsedGroq = nettoyerEtParserJSON(groqData.choices[0].message.content);
                if (parsedGroq) {
                    return { ok: true, data: parsedGroq };
                }
            } else {
                derniereErreur = groqData?.error?.message || `Groq HTTP ${groqResp.status}`;
            }
        } catch (e) {
            derniereErreur = e.message;
        }
    }

    return { ok: false, erreur: derniereErreur };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ valide: false, message: 'Méthode non autorisée' });
    }

    try {
        const { mode = 'document', imageBase64, documentAttendu, contexteDossier, descriptionSituation } = req.body || {};
        const geminiKey = process.env.GEMINI_API_KEY;
        const groqKey = process.env.GROQ_API_KEY;

        if (!geminiKey && !groqKey) {
            return res.status(200).json({
                ok: false,
                valide: false,
                message: "Clé GEMINI_API_KEY manquante dans Vercel."
            });
        }

        // MODE 1 : RECHERCHE DE DOSSIER OU LECTURE DE COURRIER ADMINISTRATIF
        if (mode === 'diagnostic') {
            const promptDiag = `Tu es un conseiller administratif français expert anti-rejet.
Date du jour : 19 novembre 2026.
Demande ou courrier de l'utilisateur : "${descriptionSituation || 'Vérification dossier'}".

Réponds UNIQUEMENT par un objet JSON valide et concis :
{
  "resume": "Explication claire en 1 ou 2 phrases max.",
  "reponse_type": "Court message officiel si blocage (sinon chaîne vide)",
  "pieces": [
    {
      "id": "id_court",
      "titre": "Nom officiel du document",
      "info": "Consigne courte (max 15 mots)",
      "format": "carte",
      "couleur": false
    }
  ]
}
Règles :
- Liste uniquement les pièces principales obligatoires (maximum 6 pièces, descriptions courtes).
- "format" doit être "carte" pour CNI/Permis/Titre de séjour, "passeport" pour un passeport, ou "a4" pour tout autre document.
- Mets "couleur": true uniquement pour les pièces d'identité.`;

            const resIA = await appelerCascadeIA(promptDiag, imageBase64, geminiKey, groqKey);
            if (!resIA.ok) {
                return res.status(200).json({ ok: false, message: `Serveurs IA saturés (${resIA.erreur}). Réessayez dans 5 secondes.` });
            }
            return res.status(200).json({ ok: true, ...resIA.data });
        }

        // MODE 2 : VÉRIFICATION D'UN DOCUMENT SCANNÉ
        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(200).json({ valide: false, message: "Fichier image invalide." });
        }

        const base64Pur = imageBase64.split(',')[1];
        if (base64Pur.length < 3500) {
            return res.status(200).json({ valide: false, message: "Image trop petite ou floue, rescannez." });
        }

        const promptDoc = `Tu es un contrôleur administratif français strict et bienveillant.
Date du jour : 19 novembre 2026.
Contexte du dossier : "${contexteDossier || 'Démarche administrative'}".
Document attendu : "${documentAttendu}".

Analyse l'image et réponds UNIQUEMENT par un objet JSON valide :
{
  "valide": true,
  "message": "Explication courte en français (max 14 mots)",
  "pieces_manquantes": [
    {
      "id": "ref_detectee",
      "titre": "Nom exact de la pièce complémentaire obligatoire détectée",
      "info": "Pourquoi l'administration bloque sans ce papier (max 15 mots)",
      "couleur": false
    }
  ]
}

Règles :
1. Vérifie la NATURE exacte du document : si c'est un objet, un selfie, un écran noir ou un AUTRE document que "${documentAttendu}", mets OBLIGATOIREMENT "valide": false et indique quel document tu vois.
2. Si c'est bien "${documentAttendu}" et que les infos clés sont lisibles, mets "valide": true.
3. Si en lisant ce document tu repères une mention imposant une pièce piège supplémentaire (ex: Réf. 44 / 48SI -> ajouter "Relevé d'Information Restreint (Réf. 7)"), ajoute-la dans "pieces_manquantes". Sinon laisse [].`;

        const resDoc = await appelerCascadeIA(promptDoc, imageBase64, geminiKey, groqKey);
        if (!resDoc.ok) {
            // Filet de sécurité si tous les modèles subissent un pic de trafic simultané
            return res.status(200).json({
                valide: true,
                message: "Scan enregistré (serveur IA surchargé, vérifiez la lisibilité).",
                pieces_manquantes: []
            });
        }

        return res.status(200).json({
            valide: Boolean(resDoc.data.valide),
            message: resDoc.data.message || (resDoc.data.valide ? "Document conforme." : "Document non conforme."),
            pieces_manquantes: Array.isArray(resDoc.data.pieces_manquantes) ? resDoc.data.pieces_manquantes : []
        });

    } catch (error) {
        return res.status(200).json({
            valide: false,
            message: `Erreur serveur : ${error.message}`
        });
    }
}







