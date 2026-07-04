process.env.HTTP_PROXY="http://dummy:1234";

const url = "http://127.0.0.1:20128";

if (url.includes('localhost') || url.includes('127.0.0.1')) {
  const currentNoProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  const locals = ['127.0.0.1', 'localhost'];
  const parts = currentNoProxy.split(',').map(p => p.trim()).filter(Boolean);
  let updated = false;
  for (const local of locals) {
    if (!parts.includes(local)) {
      parts.push(local);
      updated = true;
    }
  }
  if (updated) {
    process.env.NO_PROXY = parts.join(',');
    process.env.no_proxy = process.env.NO_PROXY;
  }
}

fetch(url).then(r => console.log("ok", r.status)).catch(e => console.log("err", e.message));
