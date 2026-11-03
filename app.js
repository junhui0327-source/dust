/**
 * app.js — 대기오염 정보 조회 메인 스크립트
 * 한국환경공단 에어코리아 오픈 API 연동
 */

// ── API 설정값 ──
// 인증키는 서버(api/dust.js)에서 환경변수로 관리한다 — 클라이언트 코드에 기재하지 않음
// Vercel 서버리스 프록시 엔드포인트
const API_URL = "/api/dust";

// ── 등급 정보 매핑 ──
// pm10Grade 값(1~4)에 해당하는 한국어 레이블과 CSS 클래스
const GRADE_INFO = {
  1: { label: "좋음",     cls: "card-grade-1" },
  2: { label: "보통",     cls: "card-grade-2" },
  3: { label: "나쁨",     cls: "card-grade-3" },
  4: { label: "매우나쁨", cls: "card-grade-4" },
};

// ── DOM 요소 참조 ──
// 시도 선택 드롭다운
const sidoSelect   = document.getElementById("sidoSelect");
// 측정소 카드 목록 컨테이너
const cardGrid     = document.getElementById("cardGrid");
// 로딩 표시 영역
const loadingWrap  = document.getElementById("loadingWrap");
// 에러 메시지 박스
const errorBox     = document.getElementById("errorBox");
const errorMsg     = document.getElementById("errorMsg");
// 요약 카드 내 각 표시 요소
const summaryRegion = document.getElementById("summaryRegion");
const summaryPm10   = document.getElementById("summaryPm10");
const summaryPm25   = document.getElementById("summaryPm25");
const summaryTime   = document.getElementById("summaryTime");

// ── "전국" 선택 시 사용할 시도 목록 ──
const ALL_SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

// ────────────────────────────────────────────────
// 유틸리티 함수
// ────────────────────────────────────────────────

/**
 * 측정값이 유효한 숫자인지 확인한다 ("-" 또는 빈 값은 무효 처리)
 * @param {string|number} val
 * @returns {boolean}
 */
function isValidValue(val) {
  // "-" 문자, 빈 문자열, null, undefined를 모두 무효로 판단
  if (val === null || val === undefined || val === "" || val === "-") return false;
  return !isNaN(Number(val));
}

/**
 * 유효하지 않은 측정값을 "측정 안 됨" 문자열로 변환한다
 * @param {string|number} val
 * @param {string} unit  단위 문자열 (예: "㎍/㎥")
 * @returns {string}
 */
function formatValue(val, unit = "㎍/㎥") {
  // 유효하지 않으면 측정 안 됨 표시
  if (!isValidValue(val)) return "측정 안 됨";
  return `${val} ${unit}`;
}

/**
 * 등급 값(pm10Grade)에 따른 CSS 클래스와 레이블을 반환한다
 * @param {string|number} grade
 * @returns {{ cls: string, label: string }}
 */
function getGradeInfo(grade) {
  // 등급 값을 숫자로 변환해 매핑 테이블에서 찾는다
  const key = parseInt(grade, 10);
  return GRADE_INFO[key] || { label: "등급 없음", cls: "card-grade-none" };
}

/**
 * 숫자 배열의 평균을 소수점 1자리로 반환한다
 * @param {number[]} nums
 * @returns {string}
 */
function calcAverage(nums) {
  // 유효한 숫자가 없으면 "-" 반환
  if (!nums.length) return "-";
  const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
  return avg.toFixed(1);
}

// ────────────────────────────────────────────────
// UI 상태 제어 함수
// ────────────────────────────────────────────────

/** 로딩 인디케이터 표시 */
function showLoading() {
  // 로딩 영역을 보여주고 카드/에러 영역을 초기화한다
  loadingWrap.hidden = false;
  errorBox.hidden    = true;
  cardGrid.innerHTML = "";
}

/** 로딩 인디케이터 숨기기 */
function hideLoading() {
  loadingWrap.hidden = true;
}

/**
 * 에러 메시지를 화면에 표시한다
 * @param {string} msg
 */
function showError(msg) {
  // 에러 박스를 표시하고 메시지를 삽입한다
  errorBox.hidden = false;
  errorMsg.textContent = msg;
}

// ────────────────────────────────────────────────
// 카드 렌더링
// ────────────────────────────────────────────────

/**
 * 측정소 데이터 객체 하나를 카드 HTML 요소로 변환해 반환한다
 * @param {Object} item  API 응답의 개별 측정소 데이터
 * @returns {HTMLElement}
 */
function createCard(item) {
  // 등급 정보 조회
  const { cls, label } = getGradeInfo(item.pm10Grade);

  // 카드 컨테이너 생성
  const card = document.createElement("div");
  card.className = `station-card ${cls}`;

  // 카드 내용 HTML 구성
  card.innerHTML = `
    <div class="card-station-name">${item.stationName || "이름 없음"}</div>
    <div class="card-grade-badge">${label}</div>

    <div class="card-row">
      <span class="card-row-label">💨 미세먼지 (PM10)</span>
      <span class="card-row-value">${formatValue(item.pm10Value)}</span>
    </div>

    <div class="card-row">
      <span class="card-row-label">🌫️ 초미세먼지 (PM2.5)</span>
      <span class="card-row-value">${formatValue(item.pm25Value)}</span>
    </div>

    <div class="card-time">🕐 ${item.dataTime || "시각 정보 없음"}</div>
  `;

  return card;
}

/**
 * 측정소 목록을 카드 그리드에 렌더링한다
 * @param {Object[]} items  측정소 데이터 배열
 */
function renderCards(items) {
  // 기존 카드 초기화 후 새로 삽입
  cardGrid.innerHTML = "";

  // 데이터가 없을 때 안내 메시지 표시
  if (!items.length) {
    cardGrid.innerHTML =
      '<p style="grid-column:1/-1;text-align:center;color:#6b7280;padding:32px 0;">측정 데이터가 없습니다.</p>';
    return;
  }

  // 각 측정소 카드를 생성해 그리드에 추가
  items.forEach((item) => {
    cardGrid.appendChild(createCard(item));
  });
}

/**
 * 요약 카드에 지역명, 평균 PM10·PM25, 기준 시각을 업데이트한다
 * @param {string}   regionName  선택된 시도 이름
 * @param {Object[]} items       측정소 데이터 배열
 */
function updateSummary(regionName, items) {
  // 선택 지역 표시
  summaryRegion.textContent = regionName;

  // 유효한 PM10 수치만 추출해 평균 계산
  const pm10Vals = items
    .filter((i) => isValidValue(i.pm10Value))
    .map((i) => Number(i.pm10Value));
  summaryPm10.textContent = calcAverage(pm10Vals);

  // 유효한 PM25 수치만 추출해 평균 계산
  const pm25Vals = items
    .filter((i) => isValidValue(i.pm25Value))
    .map((i) => Number(i.pm25Value));
  summaryPm25.textContent = calcAverage(pm25Vals);

  // 첫 번째 유효한 측정 시각을 기준 시각으로 사용
  const firstTime = items.find((i) => i.dataTime)?.dataTime || "-";
  summaryTime.textContent = firstTime;
}

// ────────────────────────────────────────────────
// API 호출
// ────────────────────────────────────────────────

/**
 * 에어코리아 API에서 특정 시도의 대기오염 데이터를 가져온다
 * 공공데이터포털 직접 호출 대신 /api/dust 서버리스 프록시를 경유한다
 * @param {string} sidoName  시도 이름 (예: "서울")
 * @returns {Promise<Object[]>}  측정소 데이터 배열
 */
async function fetchAirData(sidoName) {
  // 서버리스 프록시에 sido 쿼리 파라미터를 붙여 요청
  const url = `${API_URL}?sido=${encodeURIComponent(sidoName)}`;

  // 15초 타임아웃 — 응답 없을 때 무한 로딩 방지
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("요청 시간이 초과됐습니다. 네트워크 상태를 확인해주세요.");
    }
    throw new Error("서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.");
  }
  clearTimeout(timeoutId);

  // HTTP 오류 처리
  if (!response.ok) {
    // 서버가 반환한 JSON 에러 메시지가 있으면 사용한다
    let serverMsg = "";
    try {
      const errJson = await response.json();
      serverMsg = errJson.error || "";
    } catch {
      // 무시
    }
    throw new Error(serverMsg || `API 요청 실패: HTTP ${response.status}`);
  }

  // JSON 파싱
  const json = await response.json();

  // 서버가 에러 메시지를 반환했을 때
  if (json.error) {
    throw new Error(json.error);
  }

  // 응답 구조 검증
  const items = json?.items;
  if (!items || !Array.isArray(items)) {
    throw new Error("응답 데이터 형식이 올바르지 않습니다.");
  }

  return items;
}

/**
 * 전국 데이터를 여러 시도에 걸쳐 병렬로 수집한다
 * @returns {Promise<Object[]>}
 */
async function fetchAllSido() {
  // 모든 시도에 대해 동시 요청을 보내 결과를 하나로 합친다
  const results = await Promise.allSettled(
    ALL_SIDO.map((sido) => fetchAirData(sido))
  );

  // 성공한 요청의 데이터만 수집 (실패한 시도는 건너뜀)
  const merged = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      merged.push(...r.value);
    } else {
      console.warn(`[${ALL_SIDO[idx]}] 데이터 요청 실패:`, r.reason);
    }
  });

  return merged;
}

// ────────────────────────────────────────────────
// 메인 흐름
// ────────────────────────────────────────────────

/**
 * 선택된 시도에 맞게 데이터를 로드하고 화면을 업데이트한다
 * @param {string} sidoName
 */
async function loadData(sidoName) {
  // 로딩 시작
  showLoading();

  try {
    let items;

    // "전국" 선택 시 모든 시도 데이터를 병렬 수집
    if (sidoName === "전국") {
      items = await fetchAllSido();
    } else {
      // 특정 시도 단일 요청
      items = await fetchAirData(sidoName);
    }

    // 요약 카드 업데이트
    updateSummary(sidoName, items);

    // 측정소 카드 렌더링
    renderCards(items);

  } catch (err) {
    // 에러 발생 시 메시지 표시
    console.error("데이터 로드 오류:", err);
    showError(`데이터를 불러오지 못했습니다. (${err.message})`);
  } finally {
    // 성공·실패 모두 로딩 숨기기
    hideLoading();
  }
}

// ────────────────────────────────────────────────
// 이벤트 리스너 등록
// ────────────────────────────────────────────────

// 드롭다운 변경 시 선택된 시도 데이터 로드
sidoSelect.addEventListener("change", () => {
  loadData(sidoSelect.value);
});

// ── 페이지 최초 로드 시 기본값(서울) 데이터 표시 ──
// DOM이 완전히 로드된 뒤 초기 요청 실행
document.addEventListener("DOMContentLoaded", () => {
  // 초기 선택값을 "서울"로 설정
  sidoSelect.value = "서울";
  loadData("서울");
});

