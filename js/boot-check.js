// Filet de sécurité : si l'application n'a pas démarré après quelques secondes (fichier manquant,
// mauvaise version d'un module, navigateur trop ancien), on l'indique au lieu de laisser une page vide.
setTimeout(() => {
  if (window.__nostrBooted) return;
  const view = document.getElementById('view');
  if (!view) return;
  const p = document.createElement('p');
  p.setAttribute('role', 'alert');
  p.textContent = "Le client n'a pas pu démarrer : un fichier est manquant ou n'est pas à jour, ou le navigateur est trop ancien. / The client failed to start: a file is missing or outdated, or the browser is too old.";
  view.replaceChildren(p);
}, 5000);
