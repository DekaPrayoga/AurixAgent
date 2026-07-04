const http = require('http');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', () => {
    console.log("=== INCOMING REQUEST TO MOCK SERVER ===");
    console.log(`Method: ${req.method} ${req.url}`);
    console.log("Headers:");
    console.log(JSON.stringify(req.headers, null, 2));
    console.log("Body:");
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }
    console.log("======================================");
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: "Halo dari mock server!" }, finish_reason: "stop" }]
    }));
  });
});

server.listen(20129, () => {
  console.log("Mock server running on port 20129");
});
