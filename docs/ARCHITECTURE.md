# Architecture

- `index.html` : page unique, CSP en `<meta>`, routage par hash (`#/feed`, `#/profile/…`, `#/dm`, `#/settings`…).
- `js/main.js` : point d'entrée, routeur, initialisation des modules, badges.
- `js/nostr/` : couche protocole **pure** (aucun accès au DOM) : clés, NIP-19, événements, NIP-05, NIP-44/17 (`dm.js`), NIP-57, NIP-47, sourdine, notifications, recherche, sauvegarde.
- `js/relays/` : pool de relais (reconnexion à backoff exponentiel, déduplication, NIP-42), abonnements, requêtes ponctuelles, NWC, recherche.
- `js/*.js` (dms, zap, wallet, mute, notifications, queue, publish…) : logique applicative, état et événements.
- `js/ui/` : rendu en JavaScript natif. Le contenu externe passe **uniquement** par `textContent` via l'assistant `el()`.
- `js/storage/` : réglages (localStorage), cache et DM (IndexedDB v2), coffre chiffré (`vault.js`).
- `vendor/` : nostr-tools, version exacte épinglée, servie localement (pas de CDN).
- `data/` : relais, traductions FR / EN.
- `sw.js` : service worker (réseau d'abord, coque hors ligne). `manifest.json` : PWA.

Principes : un module = une responsabilité ; abonnements fermés dès qu'inutiles ; `limit`/`since`/`until` systématiques ; signatures vérifiées hors du fil principal.
