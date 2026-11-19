export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(200).json({ valide: false, ok: false, message: 'Méthode non autorisée' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length < 10) {
        return res.status(200).json({
            valide: false,
            ok: false,
            message: "Clé GEMINI_API_KEY absente ou vide sur Vercel."
        });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { mode, imageBase64, documentAttendu, contexteDossier, descriptionSituation } = body;

        // MODE 1 : LECTEUR DE COURRIER RECU & RECHERCHE DE DEMARCHE
        if (mode === 'diagnostic') {
            const promptDiagnostic = `Tu es un expert administratif français intraitable.
Date du jour : 19 novembre 2026.
Situation ou demande de l'utilisateur : "${descriptionSituation || 'Analyse du courrier joint'}".

Analyse attentivement le texte et l'image (si fournie) et réponds STRICTEMENT en JSON valide :
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
                parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
            }

            const reponseGemini = await appelerGeminiCascade(apiKey.trim(), parts);
            return res.status(200).json(reponseGemini);
        }

        // MODE 2 : CONTROLE STRICT ZÉRO TOLÉRANCE DES INFORMATIONS DU DOCUMENT
        if (!imageBase64 || !imageBase64.includes(',')) {
            return res.status(200).json({
                valide: false,
                message: "Aucune image reçue. Veuillez reprendre la photo."
            });
        }

        const [meta, base64Data] = imageBase64.split(',');
        const mimeType = meta.match(/:(.*?);/)?.[1] || 'image/jpeg';

        const promptVerification = `Tu es un contrôleur administratif français ZÉRO TOLÉRANCE (préfecture, banque, notaire, CAF).
Date du jour : 19 novembre 2026.
Document attendu : "${documentAttendu}"
Dossier concerné : "${contexteDossier || 'Dossier administratif'}"

INSPECTE LE DOCUMENT POINT PAR POINT. DÈS QU'UN SEUL ÉLÉMENT MANQUE OU EST COUPÉ, METS "valide": false :

1. CONFORMITÉ DU DOCUMENT ET DE LA FACE :
   - Vérifie que le document correspond EXACTEMENT à "${documentAttendu}".
   - Si c'est un autre document, un écran, un objet, ou le verso au lieu du recto (ou inversement) -> REFUSER en précisant ce que tu vois réellement.

2. CONTRÔLE EXHAUSTIF DES CHAMPS OBLIGATOIRES (NE RIEN LAISSER PASSER) :
   - Pièce d'identité (CNI, Passeport, Permis, Titre de séjour) :
     * Recto : les 4 coins de la carte, la photo d'identité entière, le nom, tous les prénoms, le sexe, la nationalité, la date et le lieu de naissance, le numéro du document et la date d'expiration doivent être 100 % visibles et non coupés.
     * Verso : les 4 coins, l'adresse complète, l'autorité de délivrance, la date de délivrance et les 3 lignes complètes de la bande MRZ (chevrons <<<) doivent être entièrement visibles et lisibles.
     * Validité : si la date d'expiration est dépassée par rapport au 19/11/2026 -> REFUSER (document expiré).
   - Justificatif de domicile :
     * L'en-tête/logo de l'organisme émetteur (EDF, Engie, eau, opérateur télécom, bailleur), le nom et prénom du titulaire, l'adresse postale complète et la DATE D'ÉMISSION doivent être visibles.
     * Si la date manque, est coupée, ou date de plus de 3 mois (avant le 19 août 2026) -> REFUSER en précisant la date constatée ou manquante.
   - Attestation d'hébergement :
     * Identité complète de l'hébergeur, identité complète de l'hébergé, adresse du logement, date de rédaction et SIGNATURE manuscrite doivent être présentes. Sans date ou sans signature -> REFUSER.
   - RIB (Relevé d'Identité Bancaire) :
     * Nom de la banque, nom et prénom du titulaire, code IBAN complet (27 caractères en France) et code BIC doivent être entièrement visibles et lisibles.
   - Bulletin de salaire / Avis d'imposition / Cerfa / Contrat :
     * Identité du titulaire, période/année concernée, en-tête officiel, montants principaux et signatures (si contrat/Cerfa) doivent être complets et non tronqués.

3. NETTETÉ ET OBSTACLES :
   - Si un doigt, un objet, un reflet de flash ou du flou masque même un seul chiffre, une lettre ou un bord -> REFUSER en indiquant exactement quelle information est masquée ou floue.

IMPORTANT : Formule un message court, direct et précis qui nomme EXACTEMENT l'information manquante, coupée, expirée ou illisible.

Réponds STRICTEMENT en JSON valide :
{
  "valide": true ou false,
  "message": "Si valide=true : confirmation précise. Si valide=false : motif exact du rejet et action corrective.",
  "pieces_manquantes": []
}`;

        const resultat = await appelerGeminiCascade(apiKey.trim(), [
            { text: promptVerification },
            { inline_data: { mime_type: mimeType, data: base64Data } }
        ]);

        return res.status(200).json({
            valide: Boolean(resultat.valide),
            message: resultat.message || (resultat.valide ? "Document conforme et net." : "Document refusé : informations incomplètes ou coupées."),
            pieces_manquantes: Array.isArray(resultat.pieces_manquantes) ? resultat.pieces_manquantes : []
        });

    } catch (erreur) {
        return res.status(200).json({
            valide: false,
            ok: false,
            message: "Refus technique IA : " + (erreur.message || "Erreur inconnue")
        });
    }
}

async function appelerGeminiCascade(apiKey, parts) {
    const modeles = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    let derniereErreur = "Aucune réponse de Gemini";

    for (const modele of modeles) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts }],
                    generationConfig: {
                        temperature: 0.05,
                        responseMimeType: "application/json"
                    }
                })
            });

            const data = await response.json();
            if (!response.ok) {
                derniereErreur = data.error?.message || `HTTP ${response.status} sur ${modele}`;
                continue;
            }

            const texteBrut = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (!texteBrut) {
                derniereErreur = `Réponse vide de ${modele}`;
                continue;
            }

            const jsonNettoye = texteBrut.replace(/```json|```/g, '').trim();
            return JSON.parse(jsonNettoye);
        } catch (err) {
            derniereErreur = err.message;
        }
    }

    throw new Error(derniereErreur);
}





