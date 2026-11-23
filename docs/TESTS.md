# Tests

- Unitaires : `node --test tests/*.test.mjs` (protocole, DM, zaps, NWC, sourdine, relais, NIP-46…).
- Parcours navigateur (Playwright, relais simulés) : démarrage, DM, zaps, NWC, M8, XSS, accessibilité, performances.
- Mesures M9 (relais simulés, CPU ralenti ×4, page de 30 notes) : première note < 2 s, plus longue tâche bloquante < 100 ms.

## Recette manuelle sur appareil
1. Connexion NIP-07 puis NIP-46 ; publier une note et la retrouver sur 2 relais.
2. DM NIP-17 dans les deux sens avec un autre client.
3. Zap réel avec WebLN ou NWC ; reçu visible sur la note.
4. Notifications, recherche, sourdine, export puis import JSON.
5. Ajout à l'écran d'accueil, démarrage en mode avion.
6. Moitié des relais injoignables : l'application reste utilisable.
