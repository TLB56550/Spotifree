/** Page affichée à un appareil pas encore associé. Autonome : aucune ressource externe. */
export const PAIR_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07080a">
<meta name="robots" content="noindex">
<title>Associer ce téléphone</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: #07080a; color: #f2efe9; font: 16px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; }
  main { min-height: 100dvh; display: grid; align-content: center; justify-items: center; gap: 18px; padding: 32px 24px calc(32px + env(safe-area-inset-bottom)); text-align: center; }
  .logo { width: 72px; height: 72px; }
  h1 { margin: 0; font-size: 1.7rem; line-height: 1.15; letter-spacing: -0.01em; }
  p { margin: 0; max-width: 34ch; color: #b4b0a8; }
  form { display: grid; gap: 12px; width: min(100%, 320px); margin-top: 6px; }
  input { width: 100%; padding: 16px; border-radius: 14px; border: 1px solid #2a2f3a; background: #12151a; color: #f2efe9; font: 600 1.6rem/1 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: 0.18em; text-align: center; text-transform: uppercase; }
  input:focus { outline: 2px solid #f2b134; outline-offset: 2px; border-color: transparent; }
  button { padding: 15px 18px; border: 0; border-radius: 999px; background: #f2b134; color: #1a1305; font: 700 1rem/1 inherit; cursor: pointer; }
  button:disabled { opacity: .55; }
  #msg { min-height: 1.5em; color: #ff8f7a; max-width: 30ch; }
  #msg.ok { color: #9fe0a8; }
</style>
</head>
<body>
<main>
  <svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#14171d"/><circle cx="32" cy="32" r="22" fill="#0c0e12" stroke="#2a2f3a" stroke-width="2"/><circle cx="32" cy="32" r="15" fill="none" stroke="#2a2f3a" stroke-width="1.5"/><circle cx="32" cy="32" r="9" fill="#f2b134"/><circle cx="32" cy="32" r="2.5" fill="#14171d"/></svg>
  <h1>Associer ce téléphone</h1>
  <p>Sur ton PC, ouvre Ma Bibliothèque, va dans <strong>Paramètres</strong>, section <strong>Téléphone</strong>, puis recopie le code affiché. Il est valable 10 minutes.</p>
  <form id="f" autocomplete="off">
    <input id="c" name="code" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="9" placeholder="XXXX-XXXX" aria-label="Code d'association" required>
    <button id="b" type="submit">Associer</button>
    <p id="msg" role="status" aria-live="polite"></p>
  </form>
</main>
<script>
(function () {
  var input = document.getElementById('c');
  var button = document.getElementById('b');
  var msg = document.getElementById('msg');
  function show(text, ok) { msg.textContent = text; msg.className = ok ? 'ok' : ''; }
  function clean(v) { return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
  function pretty(v) { return v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; }
  input.addEventListener('input', function () { input.value = pretty(clean(input.value)); });
  function submit(code) {
    button.disabled = true;
    show('Vérification…', true);
    fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mb': '1' }, body: JSON.stringify({ code: code }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) { show('Téléphone associé !', true); location.replace('/'); return; }
        show((res.body && res.body.error) || 'Association impossible.', false);
        button.disabled = false;
      })
      .catch(function () { show('Impossible de joindre le PC. Vérifie qu’il est allumé et que Ma Bibliothèque est lancée.', false); button.disabled = false; });
  }
  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = clean(input.value);
    if (code.length !== 8) { show('Le code comporte 8 caractères.', false); return; }
    submit(code);
  });
  var fromLink = clean(new URLSearchParams(location.search).get('code') || '');
  if (fromLink.length === 8) {
    history.replaceState(null, '', '/pair');
    input.value = pretty(fromLink);
    submit(fromLink);
  } else {
    input.focus();
  }
})();
</script>
</body>
</html>
`;
