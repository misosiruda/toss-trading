# Security Policy

## Supported Scope

보안 제보는 이 repository의 현재 `main` branch를 기준으로 받습니다.

제보 대상 범위는 다음을 포함합니다.

- secret, token, account, order, execution data 노출
- Local Operations API 또는 MCP tool 접근 제어 문제
- 기본값에서 live order placement, broker mutation, raw `codex exec`, raw `tossctl`, `place_order`를 열 수 있는 경로
- paper-only replay 또는 Risk Engine 경계 우회
- 이 repository에 영향을 주는 dependency 또는 build configuration 문제

## Reporting

public issue, public PR comment, public review thread에 secret, account data, token value, private broker data, exploit detail을 공개하지 않습니다.

이 repository에서 GitHub private vulnerability reporting이 활성화되어 있으면 해당 경로를 사용합니다. private reporting을 사용할 수 없으면 public disclosure 전에 repository owner에게 별도 경로로 연락합니다.

제보에는 다음 정보를 포함합니다.

- 영향을 받는 file, endpoint, tool, workflow
- 재현 절차
- 기대한 safe behavior
- 관측한 unsafe behavior
- secret 또는 private data 노출 여부

## Safety Boundary

이 repository는 paper-only와 safe-by-default를 기본 경계로 둡니다. 보안 제보는 live trading, broker mutation, natural language order placement, raw command execution surface, investment advice를 요청하거나 시연하면 안 됩니다.

이 repository는 public review를 위한 source-available repository입니다. 보안 제보는 license terms 밖에서 사용, 호스팅, 운영, 재배포, 파생 저작물 생성을 허가하지 않습니다.
