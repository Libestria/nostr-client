// Lecture JSON bornée : une réponse hostile ne doit pas pouvoir saturer la mémoire.
export async function readJsonLimited(res, max = 100000) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new Error('too-large');
  if (typeof res.text !== 'function') return res.json();
  const text = await res.text();
  if (text.length > max) throw new Error('too-large');
  return JSON.parse(text);
}
