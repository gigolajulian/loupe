// Hush keys window (hush-keys.html): save the two Discord values through LOUPE, or open Discord's page
const f = document.getElementById('f'), err = document.getElementById('err');
document.getElementById('cx').onclick = () => window.close();
document.getElementById('dev').onclick = e => { e.preventDefault(); window.loupe.hushKeys(null); };
f.onsubmit = async e => {
  e.preventDefault();
  const why = await window.loupe.hushKeys({ id: document.getElementById('cid').value.trim(), secret: document.getElementById('sec').value.trim() });
  if (why) err.textContent = why; else window.close();
};
