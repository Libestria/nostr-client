# Sécurité : modèle de menace et audit (M9)

## Principes
- **Aucune saisie de nsec** nulle part (import JSON : toute nsec est rejetée). La signature passe par NIP-07 ou NIP-46 ; la clé reste dans le signeur.
- Clés éphémères NIP-59 : générées en mémoire, jamais stockées.
- Secret NWC : chiffré avec un mot de passe (PBKDF2 + AES-GCM), verrouillé à chaque session, effacé à la déconnexion, plafond de dépense configurable.
- Contenu des événements non fiable : `textContent` uniquement, aucun `innerHTML` avec du contenu externe, URL limitées à `https:`.
- CSP stricte (meta) : `script-src 'self'`, pas de `unsafe-inline`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `referrer: no-referrer`.
- Signature et id vérifiés avant affichage et cache ; sorties du signeur contrôlées (pubkey, id, signature).
- Réponses HTTP externes (NIP-05, NIP-11, LNURL) lues avec une taille maximale.

## Résultats de l'audit
- XSS : jeu de tests (HTML / JS malveillant dans notes, profils, noms, liens) → aucune injection (`smoke-xss`).
- Accessibilité : contrastes AA, champs ≥ 44 px, navigation clavier, `prefers-reduced-motion`.
- Aucune clé privée dans le réseau, les logs ni le stockage.

## Risques résiduels connus
1. **Clé de transport NIP-46** : stockée dans `sessionStorage` (supprimée à la fermeture de l'onglet). Un XSS permettrait de demander des signatures ; d'où la CSP stricte.
2. **CSP en `<meta>`** : ne peut pas définir `frame-ancestors`, `Permissions-Policy` ni HSTS → à ajouter côté Cloudflare (voir DEPLOIEMENT.md).
3. **Relais** : chaque relais voit l'adresse IP et les requêtes. Les relais de démarrage ne sont pas affichés mais restent des tiers.
4. **Cryptographie** : NIP-44 et signatures s'appuient sur nostr-tools / le signeur ; non testées contre de vrais vecteurs dans l'environnement de développement → à valider sur appareil.
5. **Images distantes** : charger un média révèle l'IP de l'utilisateur à l'hébergeur (option de désactivation dans les réglages).
