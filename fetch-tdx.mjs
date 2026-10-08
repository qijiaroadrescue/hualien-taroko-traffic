import { mkdir, writeFile } from "node:fs/promises";

const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const BASE = "https://tdx.transportdata.tw/api/basic";
const ROUTES = {
  vd:   "/v2/Road/Traffic/Live/VD/Highway",
  cctv: "/v2/Road/Traffic/CCTV/Highway",
  news: "/v2/Road/Traffic/Live/News/Highway",
};

// 台8線：谷關 37K → 太魯閣口/新城 193K（中橫全線）；台14甲：昆陽 18K → 大禹嶺 43K（合歡山）
const T8_MIN = 37, T8_MAX = 193;
const T14_MIN = 18, T14_MAX = 43;
const in8  = (km) => Number.isFinite(km) && km >= T8_MIN  && km <= T8_MAX;
const in14 = (km) => Number.isFinite(km) && km >= T14_MIN && km <= T14_MAX;

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
      const id = String(c.CCTVID || "");
      const km = parseMile(c.LocationMile);
      const isT8  = /-0080-/.test(id) && in8(km);
      const isT14 = (/-014A-/.test(id) || /台14甲/.test(String(c.RoadName || ""))) && in14(km);
      return isT8 || isT14;
    })
    .map((c) => Object.fromEntries(KEEP.map((k) => [k, c[k]])));
  return { UpdateTime: json.UpdateTime, CCTVs: list };
}

function trimVd(json) {
  const list = (json.VDLives || []).filter((v) => {
    const id = String(v.VDID || "");
    let m = id.match(/-0080-(\d{3})-/);
    if (m) return in8(parseInt(m[1], 10));
    m = id.match(/-014A-(\d{3})-/);
    return !!m && in14(parseInt(m[1], 10));
  });
  return { ...json, VDLives: list };
}

// 中橫相關關鍵字；前端會再把非中橫新聞收進「聯外路況」折疊區
const KEYS = /台8線|台14甲|中橫|太魯閣|天祥|大禹嶺|合歡山|武嶺|昆陽|關原|梨山|德基|谷關/;
const TOWNS = ["秀林", "新城", "花蓮縣", "和平", "仁愛"];

function trimNews(json) {
  const list = (json.Newses || []).filter((item) => {
    const title = item.Title || "";
    const text = title + (item.Description || "");
    // 台8線標題有里程：只依里程判斷
    const m8 = title.match(/台8線[^\d]*(\d{1,3})K/);
    if (m8) return in8(parseInt(m8[1], 10));
    const m14 = title.match(/台14甲線[^\d]*(\d{1,3})K/);
    if (m14) return in14(parseInt(m14[1], 10));
    if (KEYS.test(text)) return true;
    // 台9／台9丁（蘇花、花東縱谷）與其他縣市不屬於中橫；花蓮縣天氣特報等保留給「聯外路況」
    if (/台9線|台9丁線|蘇花改/.test(title)) return false;
    return TOWNS.some((t) => text.includes(t)) && !/宜蘭|台北|台東|台中/.test(text);
  });
  return { ...json, Newses: list };
}

// allowEmpty：該類資料為空是正常情況
const TRIMMERS = {
  cctv: { fn: trimCctv, count: (j) => j.CCTVs.length,   allowEmpty: false },
  vd:   { fn: trimVd,   count: (j) => j.VDLives.length, allowEmpty: true  }, // 台8線偵測器可能很少
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
      try { json = JSON.parse(await res.text()); } catch { status.results[name] = "invalid json"; continue; }

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
