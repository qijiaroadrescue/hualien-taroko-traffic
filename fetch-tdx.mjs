import { mkdir, writeFile } from "node:fs/promises";

const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const BASE = "https://tdx.transportdata.tw/api/basic";
const ROUTES = {
  vd:   "/v2/Road/Traffic/Live/VD/Highway",
  cctv: "/v2/Road/Traffic/CCTV/Highway",
  news: "/v2/Road/Traffic/Live/News/Highway",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, options) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await fetch(url, options);
    if (res.status !== 429) return res;
    await sleep(15000);
  }
  return res;
}

function trimCctv(json) {
  const KEEP = ["CCTVID", "RoadID", "RoadName", "RoadDirection", "LocationMile", "VideoImageURL", "SurveillanceDescription"];
  const list = (json.CCTVs || [])
    .filter((c) => {
      if (c.RoadID !== "300090") return false;
      const km = parseInt(String(c.LocationMile || ""), 10);
      return km >= 158 && km <= 320;
    })
    .map((c) => Object.fromEntries(KEEP.map((k) => [k, c[k]])));
  return { UpdateTime: json.UpdateTime, CCTVs: list };
}

function trimVd(json) {
  const list = (json.VDLives || []).filter((v) => v.VDID && v.VDID.includes("0090"));
  return { ...json, VDLives: list };
}

function trimNews(json) {
  const list = (json.Newses || []).filter((item) => {
    const text = (item.Title || "") + (item.Description || "");
    return (
      text.includes("花蓮") ||
      text.includes("新城") ||
      text.includes("吉安") ||
      text.includes("壽豐") ||
      text.includes("鳳林") ||
      text.includes("光復") ||
      text.includes("瑞穗") ||
      text.includes("玉里") ||
      text.includes("富里") ||
      text.includes("崇德") ||
      (text.includes("台9") && !text.includes("台北") && !text.includes("宜蘭"))
    );
  });
  return { ...json, Newses: list };
}

const TRIMMERS = {
  cctv: { fn: trimCctv, count: (j) => j.CCTVs.length },
  vd:   { fn: trimVd,   count: (j) => j.VDLives.length },
  news: { fn: trimNews, count: (j) => j.Newses.length },
};

await mkdir("data", { recursive: true });
const status = { updated: new Date().toISOString(), results: {}, kept: {} };

const tokenRes = await call(TOKEN_URL, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.TDX_ID,
    client_secret: process.env.TDX_SECRET,
  }),
});

if (!tokenRes.ok) {
  status.results.token = tokenRes.status + " " + (await tokenRes.text());
} else {
  const { access_token } = await tokenRes.json();
  status.results.token = "ok";
  for (const [name, path] of Object.entries(ROUTES)) {
    try {
      const res = await call(`${BASE}${path}?$format=JSON&$top=5000`, {
        headers: { authorization: "Bearer " + access_token },
      });
      if (!res.ok) {
        status.results[name] = res.status + " " + (await res.text()).slice(0, 300);
        continue;
      }

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        status.results[name] = "invalid json";
        continue;
      }

      let out = text;
      const trimmer = TRIMMERS[name];
      if (trimmer) {
        const trimmed = trimmer.fn(json);
        const n = trimmer.count(trimmed);
        status.kept[name] = n;
        if (n > 0) out = JSON.stringify(trimmed);
      }

      await writeFile(`data/${name}.json`, out);
      status.results[name] = "ok";
    } catch (e) {
      status.results[name] = "error " + e;
    }
  }
}

await writeFile("data/status.json", JSON.stringify(status, null, 2));

const failed = Object.entries(status.results).some(([k, v]) => !k.endsWith("_kept") && v !== "ok");
if (failed) process.exitCode = 1;
