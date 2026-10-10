import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

let s = (await readFile("index.new.html", "utf8")).replace(/\r\n/g, "\n");
const miss = [];
const rep = (name, from, to) => { if (!s.includes(from)) { miss.push(name); return; } s = s.replace(from, () => to); };
const repRe = (name, re, to) => { if (!re.test(s)) { miss.push(name); return; } s = s.replace(re, () => to); };

// ── 1. 搜尋引擎與預覽 ──
rep("head", `<meta name="theme-color" content="#0d131b" />`, `<meta name="theme-color" content="#0d131b" />
<link rel="canonical" href="https://qijiaroadrescue.github.io/hualien-taroko-traffic/" />
<meta property="og:image" content="https://qijiaroadrescue.github.io/hualien-taroko-traffic/logo.png" />`);
rep("root", `<div id="root"><div class="wrap">資料載入中…</div></div>`, `<div id="root"><div class="wrap"><h1>啟佳｜中橫路況通</h1><p>台8線關原至天祥、天祥至太魯閣口的放行與管制時段，請見 <a href="https://www.thb.gov.tw/News_Content_Table.aspx?n=7839&s=305784">公路局公告</a>。救援專線 <a href="tel:0937165037">0937-165-037</a></p></div></div>`);

// ── 2. 底部固定列 ──
rep("css", `</style>`, `.fab{left:0;right:0;bottom:0;flex-direction:row;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:1px solid var(--line)}
.fab a,.fab button{flex:1;padding:12px 6px;border-radius:12px;box-shadow:none;font-size:.9rem}
.wrap{padding-bottom:90px}
</style>`);

// ── 3. 頁尾聲明 ──
rep("note", `<p class="note">啟佳｜中橫路況通為民間彙整資訊，不代表官方公告；山區路段請留意落石、起霧與臨時管制，行前請再確認公路局公告。資料來源：公路局 TDX 開放資料。</p>`,
  `<p class="note">啟佳｜中橫路況通為民間彙整資訊，不代表官方公告；山區路段請留意落石、起霧與臨時管制。資料來源：公路局 TDX 開放資料。</p>`);
repRe("legal", /<div class="legal">[\s\S]*?<\/div>/, `<div class="legal"><h5>【免責聲明】</h5><p>本網站所載之所有資料、商標、標誌、圖像、短片、聲音檔案、連結及其他資料等（以下簡稱「資料」），僅供參考之用。本公司將盡力確保本網站資料的準確性，但對於該等資料的準確性、即時性或完整性，本公司不作任何明示或默示的保證。</p>
      <h5>【著作權聲明】</h5><p>本官網之製作權（著作權）歸啟佳道路救援所有，請勿剽竊、轉載或擅自使用。<br>© 2026 啟佳道路救援 版權所有</p></div>`);

// ── 4. setup：公里數快查、資料過期警示、影像重新載入 ──
rep("setup", `const bar = g => g.plan.filter`, `const kmq = ref(''), kmRoad = ref('8'), health = ref(null);
    const kmHit = computed(() => {
      const v = parseFloat(String(kmq.value).replace(/[^\\d.]/g, ''));
      if (!isFinite(v)) return null;
      const road = kmRoad.value;
      let seg = null;
      Object.values(TABS).forEach(t => t.segs.forEach(s => { if (s.road === road && v >= s.km[0] && v < s.km[1]) seg = s; }));
      const zone = road !== '8' ? null : (v >= 114.6 && v <= 167.1 ? 'A' : v >= 167.7 && v <= 184.5 ? 'B' : null);
      const cams = allCams.value.filter(x => x.road === road).map(x => ({ x, d: Math.abs(x.km - v) })).sort((a, b) => a.d - b.d).slice(0, 3).map(o => camCard(o.x.c.LocationMile, o.x));
      return { v, seg, gate: zone ? gateOf(zone) : null, cams };
    });
    const dataWarn = computed(() => {
      const h = health.value; if (!h) return '';
      const bad = Object.entries(h.results || {}).filter(([k, v]) => v !== 'ok').map(([k]) => k);
      const age = (tick.value - new Date(h.updated)) / 60000;
      if (bad.length) return '部分資料更新失敗（' + bad.join('、') + '），目前顯示的可能是舊資料';
      if (age > 60) return '資料已超過 ' + Math.round(age) + ' 分鐘未更新';
      return '';
    });
    const reloadCams = () => { modal.value.cams.forEach(c => { c.src = c.src.replace(/t=\\d+/, 't=' + Date.now()); }); };
    const bar = g => g.plan.filter`);
rep("load status", `try { const d = await get('cctv'); if (d) cctv.value = d.CCTVs || []; } catch(e){}`,
  `try { const d = await get('cctv'); if (d) cctv.value = d.CCTVs || []; } catch(e){}
      try { health.value = await get('status'); } catch(e){}`);
rep("return", `wallMissing, pinned, hasSpeed, openWall,`, `wallMissing, pinned, hasSpeed, kmq, kmRoad, kmHit, dataWarn, reloadCams, openWall,`);

// ── 5. 求援訊息：方向、車況、安全提醒 ──
rep("openGps", `gps.value = { km:'', road:'台8線', txt:'', msg:'' };`, `gps.value = { km:'', road:'台8線', dir:'', issue:'', txt:'', msg:'' };`);
repRe("gps text", /g\.txt = `[^`]*`;/, `g.txt = '【啟佳道路救援】車輛求援\\n位置：' + g.road + (g.km ? ' ' + g.km + 'K' : '') + (g.dir ? '（' + g.dir + '）' : '') + '\\n狀況：' + (g.issue || '未填') + '\\nGPS：' + la + ',' + ln + '\\n地圖：https://www.google.com/maps?q=' + la + ',' + ln;`);
rep("gps form", `<input v-model="gps.km" placeholder="里程牌公里數，例如 114" inputmode="decimal" />`, `<input v-model="gps.km" placeholder="里程牌公里數，例如 114" inputmode="decimal" />
        <select v-model="gps.dir" style="width:100%;padding:8px;border-radius:10px;background:var(--bg);color:var(--tx);border:1px solid var(--line);margin:6px 0"><option value="">行駛方向（選填）</option><option>往花蓮／太魯閣</option><option>往大禹嶺／合歡山</option></select>
        <select v-model="gps.issue" style="width:100%;padding:8px;border-radius:10px;background:var(--bg);color:var(--tx);border:1px solid var(--line);margin:6px 0"><option value="">車況（選填）</option><option>沒電</option><option>爆胎</option><option>無法發動</option><option>事故</option><option>受困／滑落邊坡</option></select>
        <p>⚠️ 請先把車移到安全處並開警示燈；落石區與隧道內不要下車停留。有人受傷請先撥 119。</p>`);

// ── 6. 影像視窗：重新載入、官方影像 ──
rep("cam modal", `<div class="row"><h3 style="margin:0 0 10px">{{ modal.title }}</h3><button class="chip" @click="modal=null">關閉</button></div>`,
  `<div class="row"><h3 style="margin:0 0 10px">{{ modal.title }}</h3><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="chip" @click="reloadCams">重新載入</button><a class="chip" href="https://tw.live/provincial-highway/8/" target="_blank" rel="noopener">官方影像</a><button class="chip" @click="modal=null">關閉</button></div></div>`);

// ── 7. 模板：資料警示與公里數快查（放在分頁列之後）──
rep("km ui", `<div v-if="cur.overview">`, `<div v-if="dataWarn" class="alert" style="margin-top:12px">⚠️ {{ dataWarn }}，請改看官方來源。</div>
    <div class="tip" style="margin-top:14px"><b>📍 我在幾公里？</b>
      <div class="bar" style="margin:8px 0 0"><select v-model="kmRoad" style="padding:8px;border-radius:10px;background:var(--bg);color:var(--tx);border:1px solid var(--line)"><option value="8">台8線</option><option value="14A">台14甲</option></select><input v-model="kmq" inputmode="decimal" placeholder="輸入里程牌，例如 166" /></div>
      <div class="tabs" style="margin-top:8px"><button v-for="s in [110,120,130,140,150,160,170,180]" :key="s" @click="kmRoad='8'; kmq=String(s)">{{ s }}–{{ s === 180 ? 188 : s + 9 }}K</button></div>
      <div v-if="kmHit" style="margin-top:10px">
        <div v-if="kmHit.seg"><b>{{ kmHit.v }}K</b>：{{ kmHit.seg.a }} → {{ kmHit.seg.b }}</div><div v-else class="km">{{ kmHit.v }}K 不在本站收錄的路段內</div>
        <div v-if="kmHit.gate" style="margin-top:4px">放行狀態：<b>{{ kmHit.gate.txt }}</b>｜{{ kmHit.gate.nxt }}</div><div v-else class="km" style="margin-top:4px">此里程不在放行管制區間內</div>
        <div class="wall" style="margin-top:8px"><figure v-for="(c, i) in kmHit.cams" :key="i" @click="openWall(c)"><img :src="c.src" :alt="c.label" loading="lazy" @error="imgErr" /><figcaption><span>{{ c.label }}</span></figcaption></figure></div>
        <div class="ext"><a v-if="kmRoad === '8'" :href="'https://taiwanhelper.com/road/tw8?km=' + Math.floor(kmHit.v) + '#map'" target="_blank" rel="noopener">🗺️ 公里數地圖</a></div>
      </div>
    </div>
    <div v-if="cur.overview">`);

await writeFile("index.final.html", s);
const m = s.match(/<script>([\s\S]*)<\/script>/);
try { new vm.Script(m[1]); console.log("JS 語法檢查：通過"); } catch (e) { console.log("JS 語法錯誤：" + e.message); }
console.log(miss.length ? "找不到這些位置，未套用：" + miss.join("、") : "全部位置都已套用");
console.log("已輸出 index.final.html，確認無誤後改名為 index.html 即可。");
