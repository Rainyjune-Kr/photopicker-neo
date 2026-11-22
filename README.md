# Photo Picker neo

macOS와 Windows용 로컬 사진 선별 앱. 기본 프로젝트는 Tauri 2, Rust, React, TypeScript, Vite를 사용한다. 촬영 폴더 또는 형식별 하위 폴더를 열면 JPEG·HEIC·HEIF·HIF를 축소 미리보기로 탐색한다. HEIF 계열 미리보기에는 macOS Image I/O와 Windows WIC를 사용한다. Windows에 필요한 코덱이 없어도 파일명으로 탐색하고 원본을 복사할 수 있다. 좌우 방향키, 화살표 버튼, 필름스트립으로 이동하며, 같은 이름의 이미지와 RAW가 일대일로 대응하면 짝을 표시한다. RAW 폴더를 직접 열면 내장 미리보기로 탐색하고 파일명 옆에 원본 형식(예: RAW (Sony ARW))을 표시한다.

## 개발 환경

IntelliJ IDEA Ultimate에서 저장소 루트를 열고 Rust 플러그인을 활성화한다. Rust stable과 Node.js 22.12 이상인 LTS 버전을 설치한다. macOS에는 Xcode Command Line Tools, Windows에는 MSVC용 Rust 툴체인과 C++ Build Tools, WebView2가 필요하다. [Tauri 개발 환경](https://v2.tauri.app/start/prerequisites/)

## 실행

저장소 루트에서 실행한다.

```sh
npm ci
npm run tauri dev
```

## 빌드

- `npm run build` — TypeScript 검사와 프런트엔드 빌드
- `cargo check --manifest-path src-tauri/Cargo.toml` — Rust 코드 검사
- `npm run tauri build` — 현재 운영체제용 데스크톱 앱 빌드 및 패키징

## 회귀 테스트

- `npm test` — 앱 빌드와 뷰어 회귀 테스트
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 원본 짝 연결과 파일별 복사 결과 검증

## 구성

- `src/` — React 화면과 스타일
- `src-tauri/` — Rust 진입점, Tauri 설정, 창 권한과 앱 아이콘

## 사용 라이브러리와 라이선스

| 기능 | 직접 사용하는 라이브러리 | 배포 라이선스 |
| --- | --- | --- |
| 데스크톱 창, 네이티브 대화상자, 업데이트 서명 검증 | Tauri, tauri-plugin-dialog, tauri-plugin-updater, @tauri-apps/api, @tauri-apps/plugin-dialog | MIT 또는 Apache-2.0 |
| 화면 렌더링 | React, React DOM, Scheduler | MIT |
| JPEG 디코딩과 인코딩 | jpeg-decoder, jpeg-encoder | 각각 MIT 또는 Apache-2.0. 인코더의 IJG 유래 코드에는 IJG 조건도 적용 |
| EXIF 읽기 | kamadak-exif | BSD-2-Clause |
| RAW 파일 읽기와 내장 미리보기 | libopenraw 0.4.0-alpha.13 | LGPL-3.0-or-later. 파일별 MPL-2.0, LGPL-2.1-or-later 및 IJG 고지도 포함 |
| 클립보드, 외부 뷰어, 언어 감지, 임시 파일 | arboard, open, sys-locale, tempfile | open은 MIT, 나머지는 MIT 또는 Apache-2.0 |
| 직렬화 및 비동기 작업 | serde, serde_json, tokio | serde 계열은 MIT 또는 Apache-2.0, Tokio는 MIT |
| 시스템 이미지 API 연동 | core-foundation, windows | MIT 또는 Apache-2.0 |

HEIF 계열 디코딩은 macOS Image I/O와 Windows WIC의 설치된 코덱을 사용한다. 배포 패키지에 별도 HEVC 코덱이나 ExifTool을 포함하지 않는다. Windows에서 사용하는 WebView2 SDK 로더의 원문 고지도 포함한다. [WebView2 SDK 1.0.3800.47](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3800.47) · [로더 고지](src-tauri/third-party/webview2/)

개발·빌드에는 TypeScript(Apache-2.0), Vite와 React 플러그인, React 타입 정의, happy-dom(각 MIT), Tauri CLI, tauri-build, cc(각 MIT 또는 Apache-2.0)를 사용한다. 잠금 파일에서 해석한 macOS·Windows용 Rust 의존성(빌드 의존성 포함)과 프런트엔드 런타임 패키지의 버전, 원문, 저작권 고지는 앱의 `third-party/NOTICES.txt`에 들어간다. 의존성 변경 후 `npm ci`와 `python3 scripts/notices.py`로 갱신한다(Python 3.11 이상). [전체 고지](src-tauri/third-party/NOTICES.txt)

This software is based in part on the work of the Independent JPEG Group.

### 바이너리 배포 전 확인할 사항

RAW 처리 라이브러리 libopenraw는 현재 실행 파일에 정적으로 연결한다. 각 릴리스에는 LGPL·GPL 원문, 해당 버전의 라이브러리 소스, 수정한 라이브러리와 앱을 다시 연결하는 데 필요한 앱 소스 또는 오브젝트 및 빌드 방법이 필요하다. 배포 조건은 이용자의 재링크 및 라이브러리 수정 디버깅을 위한 역공학을 허용해야 한다. **앱 자체의 라이선스 또는 이에 해당하는 재링크 허용 조건은 첫 바이너리 공개 전에 저작권자가 확정해야 한다.** [LGPL v3 제4조](https://spdx.org/licenses/LGPL-3.0-or-later.html)

릴리스 워크플로는 LGPL·MPL 패키지의 정확한 원본을 잠금 파일 체크섬으로 확인해 `third-party-sources.tar`로 첨부한다. 앱 코드는 같은 릴리스 태그의 소스 아카이브를 사용한다. libopenraw를 교체해 시험하려면 아카이브 안의 libopenraw `.crate`를 풀고 `src-tauri/Cargo.toml`의 `[patch.crates-io]`에 `libopenraw = { path = "/path/to/libopenraw" }`를 추가한다. 저장소 루트에서 `npm ci` 후 `npm run tauri dev`로 실행하거나 다음 명령으로 로컬 빌드한다.

```sh
npm run tauri build -- --no-bundle
```

## 업데이트와 GitHub Releases

설정의 **앱 업데이트**에서 새 버전을 확인한다. 다운로드하는 동안 사진 선별을 계속할 수 있다. 다운로드 및 서명 확인이 끝나면 **설치하고 재시작**이 활성화된다. 이미 시작한 사진 복사가 모두 끝난 뒤 설치하며, 설치 대기 중에는 새 복사를 시작할 수 없다.

배포 담당자는 GitHub Actions의 저장소 시크릿 `TAURI_SIGNING_PRIVATE_KEY`에 앱에 내장한 공개키와 짝인 Tauri 개인키의 내용을 등록한다. 암호화된 개인키에는 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`도 등록한다. 이 키는 다음 릴리스에도 필요하므로 별도로 백업한다. Apple 코드 서명·공증과 Windows 실행 파일 서명은 별도 절차다. [Tauri 업데이트 서명](https://v2.tauri.app/plugin/updater/)

앱 버전과 일치하는 태그(첫 버전은 `v0.1.0`)를 푸시하면 워크플로가 macOS Universal DMG, 업데이트용 앱 아카이브, Windows x64 NSIS 설치 파일, 서명, `latest.json`과 대응 소스를 **릴리스 초안**에 올린다. 두 플랫폼 빌드 완료 후 초안의 파일과 라이선스 조건을 검토하고 정식 릴리스로 공개한다. 앱은 인증 없이 접근 가능한 GitHub Releases의 `releases/latest/download/latest.json`을 조회한다. 비공개 저장소를 유지할 경우 공개 배포 저장소를 준비하고 첫 패키징 전에 엔드포인트와 자산 업로드 위치를 함께 변경해야 한다.
