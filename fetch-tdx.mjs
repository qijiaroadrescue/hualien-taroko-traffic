let tokenRes = null;
try {
  tokenRes = await call(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.TDX_ID,
      client_secret: process.env.TDX_SECRET,
    }),
  });
} catch (e) {
  status.results.token = "error " + e;
}

if (!tokenRes) {
  // token 逾時：status 已記錄，略過抓取
} else if (!tokenRes.ok) {
  status.results.token = tokenRes.status + " " + (await tokenRes.text()).slice(0, 300);
} else {
