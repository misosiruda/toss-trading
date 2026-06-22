import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditEvent,
  VirtualDecision,
  VirtualPortfolio,
  VirtualTrade
} from "../domain/schemas.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import {
  buildPaperDailyReport,
  renderPaperDailyReport
} from "./paperDailyReport.js";

const generatedAt = new Date("2026-06-11T10:00:00+09:00");

async function createFixtureStorage(): Promise<string> {
  const storageBaseDir = await mkdtemp(join(tmpdir(), "toss-trading-report-test-"));
  const paths = createStoragePaths(storageBaseDir);

  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(decision());
  await new FileVirtualTradeStore(paths.virtualTradesPath).append(trade());

  const auditLog = new FileAuditLog(paths.auditLogPath);
  await auditLog.append(audit("MARKET_PACKET_CREATED", "Created packet"));
  await auditLog.append(
    audit("MARKET_PACKET_WARNING", "source warning for account 1234-5678-901234")
  );
  await auditLog.append(audit("VIRTUAL_RISK_APPROVED", "KR:005930 VIRTUAL_BUY"));
  await auditLog.append(
    audit("VIRTUAL_RISK_REJECTED", "rejected synthetic order ord_abcdef123456")
  );

  return storageBaseDir;
}

test("daily paper report summarizes portfolio, decisions, risk, and sources", async () => {
  const storageBaseDir = await createFixtureStorage();
  const report = await buildPaperDailyReport({
    storageBaseDir,
    date: "2026-06-11",
    generatedAt
  });

  assert.equal(report.mode, "paper_only");
  assert.equal(report.portfolio.virtualNetWorthKrw, 1_020_000);
  assert.equal(report.analytics.positionAllocationRatio, 0.068627);
  assert.equal(report.analytics.decisionTradeLinkage.linkedDecisionItemCount, 1);
  assert.equal(report.decisionOutcome.decisionRecordCount, 1);
  assert.equal(report.decisionOutcome.byAction["VIRTUAL_BUY"], 1);
  assert.equal(report.tradeSummary.tradeCount, 1);
  assert.equal(report.riskSummary.approvedCount, 1);
  assert.equal(report.riskSummary.rejectedCount, 1);
  assert.equal(report.sourceStatus.status, "degraded");
  assert.match(report.disclaimer, /not financial advice/);
  assert.match(report.disclaimer, /not a performance guarantee/);
});

test("rendered sample report masks sensitive values and avoids live-order wording", async () => {
  const storageBaseDir = await createFixtureStorage();
  const report = await buildPaperDailyReport({
    storageBaseDir,
    date: "2026-06-11",
    generatedAt
  });
  const rendered = renderPaperDailyReport(report);

  assert.match(rendered, /Paper Trading Daily Report/);
  assert.match(rendered, /date: 2026-06-11/);
  assert.match(rendered, /Portfolio Analytics/);
  assert.match(rendered, /exposure_by_asset_class/);
  assert.match(rendered, /exposure_by_strategy_bucket/);
  assert.match(rendered, /unknown_metadata_exposure_ratio/);
  assert.match(rendered, /decision_trade_linkage/);
  assert.match(rendered, /Paper-only virtual simulation/);
  assert.equal(rendered.includes("1234-5678-901234"), false);
  assert.equal(rendered.includes("ord_abcdef123456"), false);
  assert.equal(rendered.includes("can place live orders"), false);
  assert.match(rendered, /cannot place live orders/);
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 950_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        quantity: 1,
        averagePriceKrw: 70_000,
        marketValueKrw: 70_000,
        updatedAt: "2026-06-11T09:30:00+09:00"
      }
    ],
    updatedAt: "2026-06-11T09:30:00+09:00"
  };
}

function decision(): VirtualDecision {
  return {
    packetId: "packet_report_001",
    summary: "Fixture paper-only decision.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.8,
        budgetKrw: 70_000,
        thesis: "Fixture thesis.",
        riskFactors: ["Fixture risk."],
        dataRefs: ["fixture_source_001"],
        expiresAt: "2026-06-11T09:35:00+09:00"
      }
    ]
  };
}

function trade(): VirtualTrade {
  return {
    tradeId: "trade_report_001",
    packetId: "packet_report_001",
    decisionId: "risk_report_001",
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 70_000,
    amountKrw: 70_000,
    status: "VIRTUAL_FILLED",
    executedAt: "2026-06-11T09:31:00+09:00"
  };
}

function audit(eventType: string, summary: string): AuditEvent {
  return {
    eventId: `audit_${eventType.toLowerCase()}_${summary.length}`,
    eventType,
    actor: "system",
    summary,
    maskedRefs: [],
    createdAt: "2026-06-11T09:32:00+09:00"
  };
}
