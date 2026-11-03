/**
 * server.js — 로컬 개발용 간단한 HTTP 서버
 * .env.local 에서 AIRKOREA_KEY 를 읽어 /api/dust 엔드포인트를 제공합니다.
 * 실행: node server.js
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env.local 파싱 ──
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    process.env[key] = val;
  }
  console.log("[server] .env.local 로드 완료");
}

// ── MIME 타입 ──
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico":  "image/x-icon",
};

// ── 에어코리아 API 프록시 ──
async function handleApiDust(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const sidoName = urlObj.searchParams.get("sido") || "서울";
  const serviceKey = process.env.AIRKOREA_KEY;

  if (!serviceKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "AIRKOREA_KEY 환경변수가 없습니다." }));
  }

  const AIR_KOREA_URL =
    "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
  const apiUrl =
    `${AIR_KOREA_URL}` +
    `?serviceKey=${serviceKey}` +
    `&returnType=json` +
    `&numOfRows=100` +
    `&pageNo=1` +
    `&sidoName=${encodeURIComponent(sidoName)}` +
    `&ver=1.3`;

  // 10초 타임아웃 설정 — 외부 API가 응답 없을 때 무한 대기 방지
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const apiRes = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    const rawText = await apiRes.text();

    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      console.error("[server] 비정상 응답:", rawText.slice(0, 300));
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "인증키 또는 요청값을 확인해주세요" }));
    }

    const resultCode = json?.response?.header?.resultCode;
    const resultMsg  = json?.response?.header?.resultMsg;

    if (resultCode !== "00") {
      console.error(`[server] API 오류: ${resultCode} / ${resultMsg}`);
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        error: `API 오류: ${resultMsg || resultCode}`,
      }));
    }

    const items = json?.response?.body?.items ?? [];
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ items }));

  } catch (err) {
    clearTimeout(timeoutId);
    // 타임아웃(AbortError) vs 일반 네트워크 오류 구분
    const isTimeout = err.name === "AbortError";
    console.error("[server] 예외:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      error: isTimeout
        ? "API 서버 응답 시간이 초과됐습니다 (10초). 잠시 후 다시 시도해주세요."
        : "서버 오류가 발생했습니다.",
    }));
  }
}

// ── 정적 파일 서빙 ──
function handleStatic(req, res) {
  let filePath = req.url.split("?")[0];
  if (filePath === "/") filePath = "/index.html";
  const fullPath = path.join(__dirname, filePath);

  if (!fs.existsSync(fullPath)) {
    res.writeHead(404);
    return res.end("Not Found");
  }

  const ext = path.extname(fullPath);
  const mime = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(fullPath).pipe(res);
}

// ── HTTP 서버 ──
const PORT = 3000;
const server = http.createServer((req, res) => {
  console.log(`[server] ${req.method} ${req.url}`);
  if (req.url.startsWith("/api/dust")) {
    handleApiDust(req, res);
  } else {
    handleStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ 로컬 서버 실행 중: http://localhost:${PORT}\n`);
});

