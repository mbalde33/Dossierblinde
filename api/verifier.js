export const maxDuration = 60;

async function appelerCascadeIA(prompt, imageBase64, geminiKey, groqKey) {
    let derniereErreur = "Serveurs IA occupés";

    // 1. Google Gemini (modèles rapides et stables)
    if (geminiKey) {
        const modeles = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
        for (const modele of modeles) {
            try {
                const parts = [{ text: prompt }];
                if (imageBase64 && imageBase64.includes(',')) {
                    parts.push({
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: imageBase64.split(',')[1]
                        }
                    });
                }

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(18000),
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            maxOutputTokens: 500,
                            temperature: 0.1
                        }
                    })
                });

                const data = await response.json();
                if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const texteBrut = data.candidates[0].content.parts[0].text;
                    const matchJson = texteBrut.match(/\{[\s\S]*\}/);
                    if (matchJson) {
                        return { ok: true, data: JSON.parse(matchJson[0]) };
                    }
                } else {
                    derniereErreur = data?.error?.message || `HTTP ${response.status}`;
                }
            } catch (e) {
                derniereErreur = e.name === 'TimeoutError' ? "Délai IA dépassé" : e.message;
            }
        }
    }

    // 2. Bascule sur Groq si disponible
    if (groqKey) {
        try {
            const isVision = Boolean(imageBase64 && imageBase64.includes(','));
            const content = isVision
                ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageBase64 } }]
                : prompt;

            const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(15000),
                body: JSON.stringify({
                    model: isVision ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile',
                    temperature: 0.1,
                    max_tokens: 500,
                    messages: [{ role: 'user', content }]
                })
            });

            const groqData = await groqResp.json();
            const texteGroq = groqData.choices?.[0]?.message?.content || '';
            const matchJson = texteGroq.match(/\{[\s\S]*\}/);
            if (matchJson) {
                return { ok: true, data: JSON.parse(matchJson[0]) };
            }
        } catch (e) {
            derniereErreur = e.message;
        }
    }

    return { ok: false, erreur: derniereErreur };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ valide: false, message: 'Méthode non autorisée' });
    }

    try {
        const { mode = 'document', imageBase64, documentAttendu, contexteDossier, descriptionSituation } = req.body;
        const geminiKey = process.env.GEMINI_API_KEY;
        const groqKey = process.env.GROQ_API_KEY;

        if (!geminiKey && !groqKey) {
            return res.status(200).json({
                valide: false,
                message: "Clé API IA manquante sur Vercel."
            });
        }

        // MODE 1 : DIAGNOSTIC ANTI-BLOCAGE OU TRADUCTION DE COURRIER ADMINISTRATIF
        if (mode === 'diagnostic') {
            const promptDiag = `Tu es un conseiller administratif français expert anti-rejet.
Date du jour : 19 novembre 2026.
Demande ou courrier de l'utilisateur : "${descriptionSituation || 'Vérification dossier'}".

Analyse la situation (et l'image du courrier joint s'il y en a une) et réponds UNIQUEMENT par un objet JSON valide au format exact suivant :
{
  "resume": "Explication claire en 2 phrases simples de ce qu'il faut faire et du piège principal à éviter",
  "reponse_type": "Court message ou courrier officiel prêt à copier-coller si un organisme bloque le dossier (sinon chaîne vide)",
  "pieces": [
    {
      "id": "identifiant_unique_sans_espace",
      "titre": "Nom exact du document officiel",
      "info": "Où l'obtenir gratuitement et vigilance exacte (ex: Réf. 7 sur mespoints.permis.gouv.fr, moins de 3 mois...)",
      "couleur": false
    }
  ]
}
Règles :
- Liste uniquement les pièces réellement obligatoires pour éviter un blocage (entre 2 et 7 pièces max).
- Mets "couleur": true uniquement pour les pièces d'identité (CNI, Passeport, Permis, Titre de séjour).
- Sois ultra-précis sur les références françaises (ex: Réf. 44, Réf. 7 RIR, Cerfa, Attestation hébergement, Tracfin, Acte de décès intégral).`;

            const resIA = await appelerCascadeIA(promptDiag, imageBase64, geminiKey, groqKey);
            if (!resIA.ok) {
                return res.status(200).json({ ok: false, message: `Analyse impossible (${resIA.erreur}). Réessayez.` });
            }
            return res.status(200).json({ ok: true, ...resIA.data });
        }

        // MODE 2 : VÉRIFICATION D'UN DOCUMENT SCANNÉ + DÉTECTION PROACTIVE DE PIÈCES PIÈGES
        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(200).json({ valide: false, message: "Fichier image invalide." });
        }

        if (imageBase64.split(',')[1].length < 4000) {
            return res.status(200).json({ valide: false, message: "Image trop floue ou petite, rescannez." });
        }

        const promptDoc = `Tu es un contrôleur administratif français strict et bienveillant.
Date du jour : 19 novembre 2026 (les documents datés de fin 2026 sont récents et valides).
Contexte du dossier : "${contexteDossier || 'Démarche administrative'}".
Document attendu : "${documentAttendu}".

Analyse attentivement l'image et réponds UNIQUEMENT par un objet JSON valide :
{
  "valide": true,
  "message": "Explication courte en français (max 14 mots)",
  "pieces_manquantes": [
    {
      "id": "ref_detectee",
      "titre": "Nom exact de la pièce complémentaire obligatoire détectée",
      "info": "Pourquoi l'administration bloque sans ce papier et où le télécharger",
      "couleur": false
    }
  ]
}

Règles strictes :
1. Vérifie la NATURE exacte du document : si c'est un objet, un selfie, un écran noir ou un AUTRE document que "${documentAttendu}" (ex: facture au lieu de CNI, recto au lieu de verso, permis au lieu de CNI), mets OBLIGATOIREMENT "valide": false et indique quel document tu vois.
2. Si c'est bien "${documentAttendu}" et que les infos clés sont lisibles, mets "valide": true.
3. Pour les justificatifs datés (domicile, paie, URSSAF, relevés), accepte août, septembre, octobre et novembre 2026.
4. DÉTECTION PROACTIVE : Si en lisant ce document tu repères une mention ou un contexte qui impose une pièce piège supplémentaire non évidente (ex: courrier Réf. 44 / 48SI mentionnant une annulation/suspension -> ajouter le "Relevé d'Information Restreint (Réf. 7)" ; document d'achat immo avec apport -> ajouter "Justificatif d'origine des fonds (Tracfin)"), ajoute-la dans "pieces_manquantes". Sinon laisse "pieces_manquantes": [].`;

        const resDoc = await appelerCascadeIA(promptDoc, imageBase64, geminiKey, groqKey);
        if (!resDoc.ok) {
            return res.status(200).json({
                valide: false,
                message: `Vérification IA impossible (${resDoc.erreur}). Appuyez sur Rescanner.`
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
            message: `Erreur technique : ${error.message}`
        });
    }
}







