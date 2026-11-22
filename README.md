# Client Nostr web

Client Nostr 100 % navigateur, sans build ni framework (modules ES natifs).
Aucune clé privée (nsec) n'est jamais saisie ni stockée : connexion par NIP-07, NIP-46 ou lecture seule.

## NIP pris en charge (M3)
NIP-01, 02 (contacts), 05, 07, 11, 19, 46 (bunker:// et nostrconnect://). Tests : `node --test tests/`.

## Lancer en local
    python3 -m http.server 8000
puis ouvrir http://localhost:8000

## Structure
- `index.html` : page unique, CSP en `<meta>`, routage par hash (`#/feed`, `#/profile/…`)
- `css/` : themes, base, layout, components
- `js/` : `main.js` (routeur), `state.js`, `i18n.js`, `ui/`, `storage/` ; `nostr/` et `relays/` à venir
- `data/` : relais par défaut, traductions FR/EN
- `vendor/` : bibliothèques épinglées (nostr-tools), à ajouter en M1

## Déploiement
À définir (GitHub Pages + Cloudflare). Le fichier `.nojekyll` est déjà présent.
