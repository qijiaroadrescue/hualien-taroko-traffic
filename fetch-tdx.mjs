import fs from 'node:fs/promises';
import path from 'node:path';

const CLIENT_ID = process.env.TDX_CLIENT_ID;
const CLIENT_SECRET = process.env.TDX_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ 缺少 TDX_CLIENT_ID 或 TDX_CLIENT_SECRET');
  process.exit(1);
}

const DATA_DIR = path.resolve('data');
const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const BASE_API = 'https://tdx.transportdata.tw/api/basic/v2/Road/Traffic';

// 台8線花蓮段里程範圍（大禹嶺約 112K ～ 太魯閣約 189K，抓 105K~200K 保留緩衝）
const MIN_KM = 105;
const MAX_KM = 200;

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token 失敗: ${res.status}`);
  return (await res.json()).access_token;
}

async function fetchTDX(endpoint, token) {
  const res = await fetch(`${BASE_API}${endpoint}?$format=JSON`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' },
  });
  if (!res.ok) throw new Error(`API 失敗 (${endpoint}): ${res.status}`);
  return res.json();
}

function parseKm(mileStr, idStr) {
  const m1 = String(mileStr || '').match(/(\d+)\s*K/i);
  if (m1) return Number(m1[1]);
  const m2 = String(idStr || '').match(/-0080-(\d{3})-/);
  if (m2) return Number(m2[1]);
  return NaN;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const token = await getAccessToken();

  // 1. 抓台8線車速 (VD)
  const vdAll = await fetchTDX('/Live/VD/Highway', token);
  const vdList = (vdAll.VDLives || []).filter((vd) => {
    const id = vd.VDID || '';
    if (!id.includes('-0080-')) return false;
    const km = parseKm('', id);
    return Number.isNaN(km) || (km >= MIN_KM && km <= MAX_KM);
  });
  await fs.writeFile(
    path.join(DATA_DIR, 'vd.json'),
    JSON.stringify({ UpdateTime: vdAll.UpdateTime || new Date().toISOString(), VDLives: vdList }, null, 2)
  );
  console.log(`✅ vd.json 完成：${vdList.length} 筆`);

  // 2. 抓台8線監視器 (CCTV)
  const cctvAll = await fetchTDX('/CCTV/Highway', token);
  const cctvList = (cctvAll.CCTVs || []).filter((cam) => {
    const isRoute8 = cam.RoadName === '台8線' || (cam.CCTVID || '').includes('-0080-');
    if (!isRoute8) return false;
    const km = parseKm(cam.LocationMile, cam.CCTVID);
    return Number.isNaN(km) || (km >= MIN_KM && km <= MAX_KM);
  });
  await fs.writeFile(
    path.join(DATA_DIR, 'cctv.json'),
    JSON.stringify({ UpdateTime: cctvAll.UpdateTime || new Date().toISOString(), CCTVs: cctvList }, null, 2)
  );
  console.log(`✅ cctv.json 完成：${cctvList.length} 支`);

  // 3. 抓中橫通報 (News)
  const newsAll = await fetchTDX('/Live/News/Highway', token);
  const NEWS_REGEX = /台8|中橫|太魯閣|天祥|大禹嶺|合歡|燕子口|九曲洞|慈恩|西寶|洛韶|關原/;
  const newsList = (newsAll.Newses || []).filter((n) =>
    NEWS_REGEX.test(`${n.Title || ''} ${n.Description || ''}`)
  );
  await fs.writeFile(
    path.join(DATA_DIR, 'news.json'),
    JSON.stringify({ UpdateTime: newsAll.UpdateTime || new Date().toISOString(), Newses: newsList }, null, 2)
  );
  console.log(`✅ news.json 完成：${newsList.length} 則`);

  // 4. 更新狀態時間
  await fs.writeFile(
    path.join(DATA_DIR, 'status.json'),
    JSON.stringify({ updated: new Date().toISOString() }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
