# Déploiement

## GitHub Pages
Dépôt `nostr-client`, branche principale, dossier racine. Le fichier `.nojekyll` est requis. HTTPS obligatoire (nécessaire au service worker et au signeur).

## Cloudflare (DNS / proxy)
Règles de transformation « en-têtes de réponse » recommandées, car une `<meta>` ne peut pas les définir :
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Content-Security-Policy: frame-ancestors 'none'`
- Cache : ne pas mettre `sw.js` en cache long (contrôle navigateur : « respecter l'origine »).

## Mise à jour
Changer le suffixe `?v=` dans `index.html` et la constante `CACHE` dans `sw.js`, puis téléverser. Les utilisateurs récupèrent la nouvelle version au rechargement suivant.

## Fichier obsolète
`data/default-relays.json` n'est plus utilisé (remplacé par `boot-relays.json` et `suggested-relays.json`) : peut être supprimé.
