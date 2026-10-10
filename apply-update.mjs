import { readFile, writeFile } from "node:fs/promises";

// 讀取原始 index.html
let html = await readFile("index.html", "utf8");

// 此處可做第一階段的基礎清理或轉換（如統一換行符號 \r\n -> \n）
html = html.replace(/\r\n/g, "\n");

// 輸出中間暫存檔 index.new.html
await writeFile("index.new.html", html);
console.log("✅ 第一階段完成：已產生 index.new.html");
