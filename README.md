# 비플페이 지도 (대구 중앙로역 부근)

대구 중앙로역 부근 식당을 OpenStreetMap 지도에 띄우고, 사용자들이 **비플페이 가능/불가능**을 투표하는 웹페이지입니다.

- 도로명·동·지명(예: 중앙로, 동성로, 남일동)을 입력하면 그 구획이 지도에 강조되고 살짝 확대됩니다.
- "중앙로역 앞"처럼 이름이 딱 맞지 않으면 Gemini AI가 맞는 구획을 찾아 줍니다.
- 투표는 다수결로 표시합니다.
  - 가능이 많으면 **형광색으로 깜빡**입니다.
  - 불가능이 많으면 **회색**입니다.
  - 투표가 없거나 동률이면 **파란색**입니다.
- 결과는 Supabase에 저장되어 모든 사용자에게 같게 보이고, 새로고침해도 유지됩니다.
- 로그인은 없습니다. 투표마다 브라우저 ID와 암호화한 IP를 로그로 남깁니다. 같은 IP에서 1시간에 **31번째 투표부터는 저장하지 않고** 안내 팝업을 띄웁니다.

> 지금 들어 있는 식당과 구획은 화면 확인용 **샘플**(샘플식당 01~16, 대략적인 구획 모양)입니다. 실제 데이터로 바꾸려면 아래 1번을 하세요.

---

## 1. aside 데이터 넣기

aside.com에서 수집한 파일 두 개를 프로젝트 폴더에 넣고 실행합니다.

```bash
npm run import-data -- 식당파일.csv 구획파일.json
```

결과는 `public/data/places.json`과 `public/data/areas.json`에 저장됩니다. 이 두 파일을 커밋하고 배포하면 반영돼요.

**식당 파일** (CSV 또는 JSON). 열 이름은 한글과 영문 모두 됩니다.

| 항목 | 열 이름 예시 |
|---|---|
| 식당명 (필수) | 식당명, 상호, 이름, name |
| 업종 | 업종, 카테고리, category |
| 주소 | 도로명주소, 주소, 지번주소 |
| 전화번호 | 전화번호, phone |
| 네이버 링크 | 링크, url |
| 네이버 플레이스 ID | id, placeId |
| 위도 / 경도 | 위도, 경도, lat, lng, y, x |

위도·경도가 없으면 주소로 좌표를 자동으로 찾습니다(1초에 1곳씩). 못 찾은 식당은 이름을 알려 주고 빠집니다.

**구획 파일** (GeoJSON 또는 JSON). 아래 둘 중 어느 형식이든 됩니다.

```json
[
  { "name": "동성로", "type": "지명", "aliases": ["동성로거리"],
    "polygon": [[35.8722, 128.5952], [35.8724, 128.5986], [35.8670, 128.5988]] },
  { "name": "중앙로", "type": "도로",
    "line": [[35.8757, 128.5962], [35.8656, 128.5933]] }
]
```

- 좌표는 `[위도, 경도]`로 적습니다. 순서가 바뀌어 있어도 자동으로 맞춥니다.
- 동이나 지명처럼 면적이 있는 구획은 `polygon`으로 적습니다.
- 도로처럼 선으로 된 구획은 `line`으로 적습니다. 도로에서 50m 안의 식당을 그 도로 식당으로 봅니다.

## 2. 내 컴퓨터에서 실행

```bash
npm install
```

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다. `.env`가 없으면 투표는 `.local/` 폴더의 테스트용 DB에 저장되고, AI 검색은 꺼집니다.

## 3. Supabase 설정

1. https://supabase.com 에서 새 프로젝트를 만듭니다.
2. **SQL Editor**를 열고 `supabase/schema.sql` 내용을 통째로 붙여넣은 뒤 **Run**을 누릅니다.
3. **Project Settings > API**에서 아래 두 값을 복사해 둡니다.
   - `Project URL` → `SUPABASE_URL`
   - `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY` (절대 공개하면 안 되는 키입니다)

투표 기록은 Supabase의 **Table Editor > vote_logs**에서 볼 수 있습니다. `accepted = false`인 줄이 제한에 걸린 투표입니다.

## 4. Gemini 키

https://aistudio.google.com/apikey 에서 무료 키를 발급받아 `GEMINI_API_KEY`에 넣습니다. 같은 검색어는 저장해 두고 다시 쓰기 때문에 무료 한도를 아낄 수 있습니다.

## 5. Vercel 배포

1. 이 폴더를 GitHub에 올립니다.
2. https://vercel.com 에서 **Add New > Project**를 누르고 저장소를 고릅니다. Framework는 **Other**, 빌드 설정은 기본값 그대로 둡니다.
3. **Environment Variables**에 `.env.example`의 항목을 채웁니다.
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`
   - `IP_HASH_SALT` (아무 긴 문자열)
4. **Deploy**를 누릅니다.

## 폴더 구조

```
public/          화면 (index.html, app.js, style.css, data/*.json)
api/             Vercel 서버 함수 (vote: 투표, tallies: 투표 현황, ai-area: AI 구획 검색)
lib/store/       저장소 (Supabase / 로컬 테스트용)
supabase/        DB 스키마
scripts/         aside 데이터 변환 스크립트
samples/         샘플 데이터 원본
dev-server.js    로컬 실행용 서버
```

## 참고

- 지도 이미지는 OpenStreetMap 기본 서버에서 받아옵니다. 소규모 사용은 괜찮지만, 접속자가 많아지면 다른 지도 서버로 바꿔야 할 수 있어요.
- 다른 사람의 투표는 15초마다 자동으로 반영됩니다.
