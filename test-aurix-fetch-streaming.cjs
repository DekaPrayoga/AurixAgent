async function run() {
  const params = {
    model: "ag/gemini-3-flash-agent",
    messages: [{"role": "user", "content": "halo"}]
  };
  
  const fetchRes = await fetch("http://localhost:20128/v1/chat/completions", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-7002034586af809a-wlmjyn-41fd59d6'
    },
    body: JSON.stringify(params)
  });
  
  try {
    const json = await fetchRes.clone().json();
    console.log("JSON response:", json);
  } catch (e) {
    console.log("It's SSE stream, not JSON");
    const text = await fetchRes.text();
    console.log("Raw Stream:\n", text);
  }
}
run();
