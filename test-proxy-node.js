fetch("http://example.com").then(r => console.log("ok", r.status)).catch(e => console.log("err", e.message));
