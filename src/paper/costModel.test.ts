import assert from "node:assert/strict";
import test from "node:test";

import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import {
  createPaperCostModel,
  PAPER_COST_MODEL_VERSION,
  PAPER_EXECUTION_MODEL_VERSION
} from "./costModel.js";

test("paper cost model exposes versioned execution assumptions", () => {
  const model = createPaperCostModel({
    feeBps: 10,
    taxBps: 20,
    slippageBps: 5,
    fillRatio: 0.5,
    allowFractionalShares: false,
    maxVolumeParticipationRate: 0.05,
    minLiquidityFillRatio: 0.2
  });

  assert.equal(model.modelVersion, PAPER_COST_MODEL_VERSION);
  assert.equal(model.executionModelVersion, PAPER_EXECUTION_MODEL_VERSION);
  assert.equal(model.fillModel, "simple_fill_ratio_with_participation_cap");
  assert.equal(model.feeModel, "fixed_bps");
  assert.equal(model.taxModel, "sell_tax_bps");
  assert.equal(model.slippageModel, "linear_bps");
  assert.equal(model.spreadModel, "not_modeled");
  assert.equal(model.marketImpactModel, "not_modeled");
  assert.equal(model.liquidityModel, "conservative_when_available");
  assert.equal(model.executionPolicy.feeBps, 10);
  assert.equal(model.executionPolicy.taxBps, 20);
  assert.equal(model.executionPolicy.slippageBps, 5);
  assert.equal(model.executionPolicy.fillRatio, 0.5);
  assert.equal(model.executionPolicy.allowFractionalShares, false);
  assert.equal(model.executionPolicy.maxVolumeParticipationRate, 0.05);
  assert.equal(model.executionPolicy.minLiquidityFillRatio, 0.2);
  assert.equal(model.executionPolicy.rejectStaleLiquidity, true);
  assert.match(createReplayResearchHash(model), /^sha256:[a-f0-9]{64}$/);
});

test("paper cost model hash changes when execution cost policy changes", () => {
  const baseline = createReplayResearchHash(createPaperCostModel());
  const withFee = createReplayResearchHash(createPaperCostModel({ feeBps: 10 }));

  assert.notEqual(baseline, withFee);
});
