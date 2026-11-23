# NIP pris en charge

| NIP | Usage | Remarques |
|---|---|---|
| 01 | Événements, filtres, vérification id + signature | Signature vérifiée avant affichage et cache (Web Worker) |
| 02 | Liste de suivis (kind 3) | Publication immédiate à chaque modification |
| 04 | DM hérités (kind 4) | Lecture seule, déchiffrement à la demande |
| 05 | Identifiant `nom@domaine` | Réponse JSON limitée à 100 ko |
| 07 | Extension `window.nostr` | Méthode recommandée |
| 09 | Suppression | Événements de l'utilisateur uniquement |
| 10 | Fils de discussion | Affichage en arbre |
| 11 | Informations de relais | Réponse limitée à 100 ko |
| 17 | Messages privés | kind 14 → 13 → 1059, relais kind 10050 |
| 18 | Reposts | kind 6 |
| 19 | npub, nsec (refusée en saisie), note, nprofile, nevent, naddr | |
| 25 | Réactions | kind 7 |
| 42 | Authentification relais | À la demande (REQ/EVENT refusés « auth-required ») |
| 44 | Chiffrement v2 | Via le signeur (la clé reste dans le signeur) |
| 46 | Signeur distant | `bunker://` et `nostrconnect://` |
| 47 | Nostr Wallet Connect | Secret chiffré par mot de passe (WebCrypto), plafond en sats |
| 50 | Recherche | Relais de recherche, WebSocket temporaires |
| 51 | Listes (sourdine kind 10000) | Partie privée chiffrée conservée |
| 57 | Zaps | Reçus vérifiés (clé du fournisseur, montant) |
| 59 | Gift wrap | Clé éphémère par message |
| 65 | Relais (kind 10002) | Modèle outbox |

Non pris en charge en v1 : Blossom / NIP-96 (téléversement), aperçus de liens, QR code de facture, NIP-04 pour NWC.
Les NIP évoluent : revérifier cette liste à chaque version.
