# Instrument Asset Taxonomy

이 문서는 paper-only replay와 market packet에서 사용하는 instrument taxonomy metadata 계약을 정리합니다.

## 목적

- 후보 종목과 historical universe를 `STOCK`, `ETF` 같은 instrument 단위로 구분합니다.
- 한국/미국/글로벌 exposure를 `region` metadata로 분리할 수 있게 합니다.
- ETF, inverse, leveraged, currency exposure 같은 특성을 AI 판단 입력과 사후 분석 report에서 명시적으로 볼 수 있게 합니다.

이 metadata는 paper-only 입력과 report용입니다. live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter로 승격하지 않습니다.

## 필드

| Field | 값 |
| --- | --- |
| `assetType` | `STOCK`, `ETF` |
| `assetClass` | `equity`, `bond`, `cash_like`, `commodity`, `currency`, `inverse`, `leveraged` |
| `region` | `KR`, `US`, `GLOBAL` |
| `riskTags` | `inverse`, `leveraged`, `currency_exposed`, `sector_concentrated` |

## 적용 범위

- `MarketCandidate`와 `HistoricalMarketSnapshot` schema에 optional metadata로 포함합니다.
- `MarketPacketBuilder`는 후보 draft의 taxonomy field를 packet candidate에 보존하고 `featureRefs`에 포함합니다.
- `TossInvestMarketData` normalizer는 기존 read-only collector 결과의 명시 필드, 이름, category, tags에서 taxonomy를 추론합니다.
- `HistoricalUniverseCoverage`는 universe manifest의 taxonomy를 symbol summary에 표시합니다.
- `docs/historical-universe.kr-expanded.json`의 현재 KR universe는 `STOCK/equity/KR`로 표기합니다.

## 제외 범위

- ETF universe 확대 자체는 후속 PR에서 수행합니다.
- 미국장 universe와 환율/통화 처리도 후속 PR 범위입니다.
- taxonomy metadata만으로 buy/sell decision, risk approval, allocation target을 자동 변경하지 않습니다.
- raw `codex exec`, raw `tossctl` MCP tool, live order path를 추가하지 않습니다.
