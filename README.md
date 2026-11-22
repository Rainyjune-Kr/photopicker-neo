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
