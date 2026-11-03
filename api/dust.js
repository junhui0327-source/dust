/**
 * api/dust.js — Vercel 서버리스 함수
 * 에어코리아 API를 서버 측에서 호출해 CORS 문제 없이 클라이언트에 데이터를 전달한다.
 * 인증키는 환경변수 AIRKOREA_KEY 에서만 읽으며, 소스 코드에 직접 기재하지 않는다.
 */

// 에어코리아 API 기본 URL
const AIR_KOREA_URL =
  "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";

/**
 * Vercel 서버리스 핸들러
 * GET /api/dust?sido=서울
 *
 * @param {import('@vercel/node').VercelRequest}  req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default async function handler(req, res) {
  // ── 1. 쿼리 파라미터에서 sido 추출 (기본값: '서울') ──
  const sidoName = req.query.sido || "서울";

  // ── 2. 환경변수에서 인증키 로드 ──
  const serviceKey = process.env.AIRKOREA_KEY;
  if (!serviceKey) {
    // 환경변수가 설정되지 않은 경우
    return res.status(500).json({ error: "서버 환경변수(AIRKOREA_KEY)가 설정되어 있지 않습니다." });
  }

  // ── 3. 공공데이터포털 API URL 조립 ──
  // Decoding 키는 이미 디코딩된 상태이므로 encodeURIComponent 없이 그대로 사용한다
  // (encodeURIComponent 적용 시 + / 등 특수문자가 이중 인코딩되어 인증 오류 발생)
  const apiUrl =
    `${AIR_KOREA_URL}` +
    `?serviceKey=${serviceKey}` +
    `&returnType=json` +
    `&numOfRows=100` +
    `&pageNo=1` +
    `&sidoName=${encodeURIComponent(sidoName)}` +
    `&ver=1.3`;

  try {
    // ── 4. 에어코리아 API 호출 ──
    const apiRes = await fetch(apiUrl);

    // 응답 텍스트를 먼저 받아, JSON 파싱 가능 여부를 확인한다
    const rawText = await apiRes.text();

    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      // JSON 파싱 실패 → XML 에러 응답 등 비정상 응답
      console.error("[dust.js] 비정상 응답(XML 등):", rawText.slice(0, 300));
      return res.status(502).json({ error: "인증키 또는 요청값을 확인해주세요" });
    }

    // ── 5. 응답 resultCode 검증 ──
    const resultCode = json?.response?.header?.resultCode;
    const resultMsg  = json?.response?.header?.resultMsg;

    if (resultCode !== "00") {
      // 성공 코드(00)가 아닐 때 한국어 안내 메시지 반환
      console.error(`[dust.js] API 오류 코드: ${resultCode} / ${resultMsg}`);
      return res.status(502).json({
        error: `API 오류가 발생했습니다: ${resultMsg || resultCode} — 인증키 또는 요청값을 확인해주세요`,
      });
    }

    // ── 6. 정상 데이터 반환 ──
    const items = json?.response?.body?.items ?? [];
    return res.status(200).json({ items });

  } catch (err) {
    // 네트워크 오류 등 예기치 못한 예외
    console.error("[dust.js] 예외:", err);
    return res.status(500).json({ error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
  }
}

