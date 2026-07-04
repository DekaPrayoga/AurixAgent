import { fetch, Agent } from 'undici';

async function run() {
  process.env.HTTP_PROXY = "http://bp-HaikZDC_area-ID:i75eZhfZzxBQqiC@proxy.bestproxy.com:2312";
  process.env.HTTPS_PROXY = "http://bp-HaikZDC_area-ID:i75eZhfZzxBQqiC@proxy.bestproxy.com:2312";

  console.log('Testing with proxy env set...');

  try {
    const fetchRes = await fetch("http://127.0.0.1:20128/v1/models", {
      method: 'GET',
      dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) 
    });
    console.log("Status:", fetchRes.status);
    const txt = await fetchRes.text();
    console.log("Result:", txt.slice(0, 100));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
