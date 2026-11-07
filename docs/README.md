# ULeveLP 차기 설계 문서 (시나리오 B: Kotlin + Google Cloud Run)

ULeveLP를 **누구나 구글 로그인만으로 쓰는 다중 사용자 웹 서비스**로 확장하면서, 백엔드를 **Kotlin (Ktor) + Google Cloud Run** 단일 컨테이너로 구축하기 위한 설계 문서 모음입니다.

| 순서 | 문서 | 핵심 내용 |
| --- | --- | --- |
| **01** | [01-project-plan.md](01-project-plan.md) | **프로젝트 기획서:** 추진 배경, 기존 BaaS 설계 대비 Cloud Run 전환 이점, 전체 아키텍처, 기술 스택, 핵심 의사결정(KC-D1~D10), P0~P6 단계별 일정 및 소요(2.5~4주), 리스크 대응 |
| **02** | [02-requirements.md](02-requirements.md) | **요구사항 정의서:** 인증(`FR-AUTH`), 곡(`FR-SONG`), 연습 세션(`FR-SESSION`), 녹음(`FR-TAKE`), 로컬 이관(`FR-LOCAL`), 기록/보관함 화면(`FR-LOG`/`FR-LIB`), 노션 입출력(`FR-NX`), 키 관리(`FR-KEY`), 실시간 연동(`FR-SYNC`), AI 학습 노트(`FR-NOTE`), 구글 드라이브(`FR-DRIVE`), 비기능 요구사항(`NFR`) |
| **03** | [03-api-spec.md](03-api-spec.md) | **기능 API 명세서:** 공통 인증·에러 규격, 도메인별 전체 REST API 엔드포인트(`Auth`, `Songs`, `Practice & Sessions`, `Takes`, `Integrations`, `Notion Sync`, `Export/Import`, `Notes`, `Chord Lab`) 요청/응답 JSON 스펙 |
| **04** | [04-db-design.md](04-db-design.md) | **DB 설계서:** ERD, PostgreSQL 16 표준 DDL(`V1__init.sql`), AES-256-GCM 키 암호화 구조, 원자적 연습 시간 합산·쿼터 잠금·Outbox 동기화 SQL 패턴, 노션 템플릿 1:1 매핑표 |

