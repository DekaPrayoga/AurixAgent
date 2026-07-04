const fs = require('fs');

let browser = fs.readFileSync('src/tools/Browser.ts', 'utf8');

const target = `    contextOptions: {
      geolocation: { latitude: geo.latitude, longitude: geo.longitude },
      permissions: ['geolocation'],
    },`;

const inject = `    contextOptions: {
      geolocation: { latitude: geo.latitude, longitude: geo.longitude },
      permissions: ['geolocation'],
      ignoreHTTPSErrors: true,
    },`;

const target2 = `    args: (() => {
      const base = [
        '--disable-webrtc',
        '--disable-rtc-sdp-logs',`;

const inject2 = `    args: (() => {
      const base = [
        '--ignore-certificate-errors',
        '--ignore-urlfetcher-cert-requests',
        '--disable-webrtc',
        '--disable-rtc-sdp-logs',`;

if (!browser.includes("ignoreHTTPSErrors: true")) {
  browser = browser.replace(target, inject);
  browser = browser.replace(target2, inject2);
  fs.writeFileSync('src/tools/Browser.ts', browser);
  console.log('Browser.ts patched for Proxy SSL Ignore');
}
