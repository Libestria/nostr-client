# Client Nostr web

Client Nostr complet, 100 % navigateur, **sans build ni framework** (HTML, CSS natif, modules ES).
Hébergement statique (GitHub Pages) en HTTPS. Aucune clé privée n'est jamais saisie, transmise ni stockée.

## Fonctions
- Connexion : extension NIP-07 (Alby, Nostash…), signeur distant NIP-46 (Clave, Amber…), lecture seule (npub / NIP-05).
- Flux abonnements / global, fils de discussion, publication, réponses, réactions, reposts, suppression.
- Profils (édition, NIP-05, suivre), modèle outbox (NIP-65), relais avec NIP-11 et NIP-42.
- Messages privés NIP-17 (NIP-44 + NIP-59), lecture des anciens NIP-04.
- Zaps NIP-57 (WebLN, lien `lightning:`, Nostr Wallet Connect NIP-47).
- Notifications, recherche NIP-50, sourdine NIP-51, export/import JSON, PWA, file d'attente hors ligne.

## Lancer en local
    python3 -m http.server 8000      # puis http://localhost:8000
    node --test tests/*.test.mjs               # tests unitaires

## Documentation
- [docs/NIPS.md](docs/NIPS.md) : NIP pris en charge
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : organisation du code
- [docs/SECURITE.md](docs/SECURITE.md) : modèle de menace et audit
- [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) : GitHub Pages, Cloudflare, en-têtes HTTP
- [docs/TESTS.md](docs/TESTS.md) : stratégie de test et recette manuelle

## Licence
À définir par le propriétaire du dépôt (MIT ou AGPL-3.0 proposées). Ajouter un fichier `LICENSE`.
