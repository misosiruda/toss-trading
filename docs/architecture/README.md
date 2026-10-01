# 제품과 아키텍처

프로젝트의 목적, 현재 코드 위치와 책임 분리를 설명한다. 실행 절차는 runbook, 세부 불변식은 contract에서 관리한다.

1. [프로젝트 개요](project-overview.md): 개인 AI 투자 트레이너 방향과 현재 구현·미완성 경계
2. [코드 구조](PROJECT_STRUCTURE.md): 실제 파일과 entrypoint 찾기
3. [시스템 아키텍처](architecture.md): 장기 책임 분리. 미래 live 경로를 현재 연결 상태로 해석하지 않음
4. [Dashboard routing](dashboard-routing-policy.md): Next.js 기본 UI와 legacy compatibility 경계
5. [Backend portfolio positioning](portfolio-positioning.md): 기존 engineering 설명과 프로젝트 소개 기준

전체 문서의 역할과 다음 계획은 [문서 안내](../README.md)를 확인한다.
