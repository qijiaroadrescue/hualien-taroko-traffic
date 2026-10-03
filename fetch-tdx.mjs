import { mkdir, writeFile } from "node:fs/promises";

const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const BASE = "https://tdx.transportdata.tw/api/basic";
const ROUTES = {
  vd:   "/v2/Road/Traffic/Live/VD/Highway",
  cctv: "/v2/Road/Traffic/CCTV/Highway",
  news: "/v2/Road/Traffic/Live/News/Highway",
};

// 花蓮縣台9線：和平 145K → 縣界橋 304.737K
const KM_MIN = 145;
const KM_MAX = 304.737;
const inRange = (km) => Number.isFinite(km) && km >= KM_MIN && km <= KM_MAX;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, options) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    if (res.status !== 429) return res;
    await sleep(15000);
  }
  return res;
}

// "166K+230" -> 166.23
function parseMile(s) {
  const m = String(s || "").match(/(\d+)\s*K\s*\+?\s*(\d*)/i);
  return m ? parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 1000 : 0) : NaN;
}

function trimCctv(json) {
  const KEEP = ["CCTVID", "RoadID", "RoadName", "RoadDirection", "LocationMile", "VideoImageURL", "SurveillanceDescription"];
  const list = (json.CCTVs || [])
    .filter((c) => {
      // 台9線本身，或 ID 屬於台9線里程樁的花蓮市區道路（康樂路、中正路一段）；排除台9丁/甲/乙/丙等支線
      const isRoute9 = String(c.RoadID) === "300090";
      const isCityRoad = /^CCTV-\d+-0090-/.test(String(c.CCTVID || "")) && !/^台9/.test(String(c.RoadName || ""));
      return (isRoute9 || isCityRoad) && inRange(parseMile(c.LocationMile));
    })
    .map((c) => Object.fromEntries(KEEP.map((k) => [k, c[k]])));
  return { UpdateTime: json.UpdateTime, CCTVs: list };
}

function trimVd(json) {
  const list = (json.VDLives || []).filter((v) => {
    const m = String(v.VDID || "").match(/-0090-(\d{3})-/);
    return m && inRange(parseInt(m[1], 10));
  });
  return { ...json, VDLives: list };
}

const TOWNS = ["花蓮", "新城", "吉安", "壽豐", "鳳林", "光復", "瑞穗", "玉里", "富里", "崇德", "秀林"];

function trimNews(json) {
  const list = (json.Newses || []).filter((item) => {
    const title = item.Title || "";
    const text = title + (item.Description || "");
    // 標題有台9線里程：只依里程判斷（排除宜蘭蘇花改、台東段）
    const m = title.match(/台9線[^\d]*(\d{2,3})K/);
    if (m) return inRange(parseInt(m[1], 10));
    // 沒有里程（例如天氣特報）：依地名判斷
    return TOWNS.some((t) => text.includes(t)) && !/宜蘭|台北|台東/.test(text);
  });
  return { ...json, Newses: list };
}

// allowEmpty：該類資料為空是正常情況（例如沒有管制新聞）
const TRIMMERS = {
  cctv: { fn: trimCctv, count: (j) => j.CCTVs.length,   allowEmpty: false },
  vd:   { fn: trimVd,   count: (j) => j.VDLives.length, allowEmpty: false },
  news: { fn: trimNews, count: (j) => j.Newses.length,  allowEmpty: true  },
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
  status.results.token = tokenRes.status + " " + (await tokenRes.text()).slice(0, 300);
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

      let json;
      try {
        json = JSON.parse(await res.text());
      } catch {
        status.results[name] = "invalid json";
        continue;
      }

      const trimmer = TRIMMERS[name];
      const trimmed = trimmer.fn(json);
      const n = trimmer.count(trimmed);
      status.kept[name] = n;

      // 過濾後為空且不應為空：保留上一份好資料，不覆蓋，並標記失敗
      if (n === 0 && !trimmer.allowEmpty) {
        status.results[name] = "empty after filter (kept previous file)";
        continue;
      }

      await writeFile(`data/${name}.json`, JSON.stringify(trimmed));
      status.results[name] = "ok";
    } catch (e) {
      status.results[name] = "error " + e;
    }
  }
}

await writeFile("data/status.json", JSON.stringify(status, null, 2));

if (Object.values(status.results).some((v) => v !== "ok")) process.exitCode = 1;
