import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readDashboardPortfolioComplianceViewModel } from "../api/dashboardViewModels.js";
import {
  createStoragePaths,
  FileVirtualPortfolioStore
} from "../storage/repositories.js";
import {
  createBucketDrawdownSemanticsRecord,
  createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord,
  createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord,
  createSessionCalendarRecord,
  drawdownSemanticsRefFor,
  hashCanonicalPayload,
  hashDerivedId,
  hashImmutableRecordLineage,
  riskRuleParameterRefFor,
  riskRuleSetRefFor,
  scheduleBoundaryRefFor,
  selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords,
  type StrategyBucket
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import {
  createPortfolioPolicyActivatedEvent,
  createPortfolioPolicyRetiredEvent,
  findActiveRuntimePortfolioPolicyAsOf,
  parsePortfolioPolicyActivationEvent,
  resolveActiveRuntimePortfolioPolicyAsOf,
  type PortfolioPolicyActivatedEvent,
  type PortfolioPolicyRetiredEvent
} from "./runtimePortfolioPolicyActivation.js";
import {
  parseRuntimePortfolioPolicyRecord,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";
import {
  RuntimePortfolioPolicyActivationFileRepository,
  createRuntimePortfolioPolicyActivationPaths,
  readConsistentRuntimePortfolioPolicyActivationSnapshot
} from "./runtimePortfolioPolicyActivationFiles.js";
import {
  RuntimePortfolioPolicyFileRepository,
  createRuntimePortfolioPolicyPaths
} from "./runtimePortfolioPolicyFiles.js";

const POLICY_CREATED_AT = "2026-08-28T00:00:00.000Z";
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;
const DEPENDENCY_FIXTURE = dependencyFixture();

test("activation event binds the complete policy tuple with a hash-derived ID", () => {
  const policy = runtimePolicy();
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const retry = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });

  assert.deepEqual(retry, event);
  assert.equal(event.effectiveFrom, event.createdAt);
  assert.equal(event.policyRecordId, policy.runtimePolicyRecordId);
  assert.equal(event.policyLineageHash, policy.lineageHash);
  assert.equal(
    event.activationId,
    `portfolio_policy_activation_${event.activationEventHash.slice("sha256:".length)}`
  );
  assert.deepEqual(parsePortfolioPolicyActivationEvent(event), event);
  assert.equal(Object.isFrozen(event), true);

  const hashTamper = structuredClone(event);
  hashTamper.policyVersion = "v2";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(hashTamper),
    /activation event hash mismatch/
  );

  const idTamper = structuredClone(event);
  idTamper.activationId = "portfolio_policy_activation_fabricated";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(idTamper),
    /activation ID mismatch/
  );

  const createdAtTamper = structuredClone(event);
  createdAtTamper.createdAt = "2026-08-28T01:00:01.000Z";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(createdAtTamper),
    /effectiveFrom must equal createdAt/
  );

  const noncanonical = structuredClone(event);
  noncanonical.portfolioId = ` ${noncanonical.portfolioId} `;
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(noncanonical),
    /must already be canonical/
  );
});

test("activation resolver deterministically folds replacement and retirement as of time", () => {
  const firstPolicy = runtimePolicy();
  const secondPolicy = runtimePolicy({ version: "v2", name: "Policy v2" });
  const first = createPortfolioPolicyActivatedEvent({
    policy: firstPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const replacement = createPortfolioPolicyActivatedEvent({
    policy: secondPolicy,
    activationSequence: 2,
    supersedesActivationId: first.activationId,
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  const retirement = createPortfolioPolicyRetiredEvent({
    portfolioId: firstPolicy.portfolioId,
    activationSequence: 3,
    retiredActivationId: replacement.activationId,
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T03:00:00.000Z"
  });
  const reopened = createPortfolioPolicyActivatedEvent({
    policy: firstPolicy,
    activationSequence: 4,
    createdAt: "2026-08-28T04:00:00.000Z"
  });
  const events = [reopened, replacement, retirement, first];
  const policies = [secondPolicy, firstPolicy];

  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T01:30:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    first.activationId
  );
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T02:30:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }).policy.runtimePolicyRecordId,
    secondPolicy.runtimePolicyRecordId
  );
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: firstPolicy.portfolioId,
        asOf: "2026-08-28T03:30:00.000Z",
        events,
        policies,
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /active runtime portfolio policy is required/
  );
  assert.equal(
    findActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T03:30:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }),
    undefined
  );
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: firstPolicy.portfolioId,
      asOf: "2026-08-28T04:00:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    reopened.activationId
  );
});

test("activation resolver rejects sequence gaps, duplicates, branches, and backdating", () => {
  const policy = runtimePolicy();
  const first = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const sequenceTwo = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 2,
    supersedesActivationId: first.activationId,
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  const resolve = (events: readonly unknown[]) =>
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: policy.portfolioId,
      asOf: "2026-08-28T05:00:00.000Z",
      events,
      policies: [policy],
      dependencies: DEPENDENCY_FIXTURE.repository
    });

  assert.throws(
    () => resolve([sequenceTwo]),
    /sequence must be contiguous from one/
  );
  assert.throws(
    () => resolve([first, first]),
    /event ID must be unique/
  );

  const firstWithSupersedes = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    supersedesActivationId: "portfolio_policy_activation_unknown",
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () => resolve([firstWithSupersedes]),
    /cannot supersede another activation/
  );

  const branch = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 2,
    supersedesActivationId: "portfolio_policy_activation_unknown",
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: policy.portfolioId,
      asOf: "2026-08-28T01:30:00.000Z",
      events: [first, branch],
      policies: [policy],
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    first.activationId
  );
  assert.throws(
    () => resolve([first, branch]),
    /must supersede the current activation/
  );

  const backdated = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 2,
    supersedesActivationId: first.activationId,
    createdAt: "2026-08-28T00:30:00.000Z"
  });
  assert.throws(
    () => resolve([first, backdated]),
    /sequence cannot be backdated/
  );

  const wrongRetirement = createPortfolioPolicyRetiredEvent({
    portfolioId: policy.portfolioId,
    activationSequence: 2,
    retiredActivationId: "portfolio_policy_activation_unknown",
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T02:00:00.000Z"
  });
  assert.throws(
    () => resolve([first, wrongRetirement]),
    /retirement must target the current activation/
  );
});

test("activation parser rejects future and backdated effective time after independent rehash", () => {
  const policy = runtimePolicy();
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });

  assert.throws(
    () =>
      parsePortfolioPolicyActivationEvent(
        rehashActivatedEvent(event, {
          effectiveFrom: "2026-08-28T01:00:01.000Z"
        })
      ),
    /effectiveFrom must equal createdAt/
  );
  assert.throws(
    () =>
      createPortfolioPolicyActivatedEvent({
        policy,
        activationSequence: 1,
        createdAt: "2026-08-28T01:00:00.0001Z"
      }),
    /must use millisecond precision/
  );
  assert.throws(
    () =>
      createPortfolioPolicyActivatedEvent({
        policy,
        activationSequence: 1,
        createdAt: "2026-02-30T01:00:00.000Z"
      }),
    /must include a valid calendar date/
  );
  assert.throws(
    () =>
      parsePortfolioPolicyActivationEvent(
        rehashActivatedEvent(event, {
          effectiveFrom: "2026-08-28T00:59:59.000Z"
        })
      ),
    /effectiveFrom must equal createdAt/
  );
});

test("activation resolver requires exact runtime policy identity and chronology", () => {
  const policy = runtimePolicy();
  const anotherPolicy = runtimePolicy({ version: "v2", name: "Policy v2" });
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const resolve = (events: readonly unknown[], policies: readonly unknown[]) =>
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: policy.portfolioId,
      asOf: "2026-08-28T02:00:00.000Z",
      events,
      policies,
      dependencies: DEPENDENCY_FIXTURE.repository
    });

  assert.throws(
    () => resolve([event], [anotherPolicy]),
    /policy record does not resolve/
  );

  const lineageMismatch = rehashActivatedEvent(event, {
    policyLineageHash: HASH_A
  });
  assert.throws(
    () => resolve([lineageMismatch], [policy]),
    /policy identity mismatch/
  );

  const futurePolicy = runtimePolicy({
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  const prematureActivation = createPortfolioPolicyActivatedEvent({
    policy: futurePolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () => resolve([prematureActivation], [futurePolicy]),
    /policy cannot postdate its activation/
  );

  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-08-28T02:00:00",
        events: [event],
        policies: [policy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /millisecond precision and include a UTC or numeric timezone offset/
  );
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-08-28T02:00:00.0001Z",
        events: [event],
        policies: [policy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /must use millisecond precision/
  );
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-02-30T02:00:00.000Z",
        events: [event],
        policies: [policy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /must include a valid calendar date/
  );
});

test("activation resolver independently resolves policy dependencies and boundary markets", () => {
  const policy = runtimePolicy();
  const event = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const missingSelection = new ImmutablePolicyDependencyRepository({
    ...DEPENDENCY_FIXTURE.records,
    selectionPolicies: DEPENDENCY_FIXTURE.records.selectionPolicies.filter(
      (record) => record.bucket !== "long_term"
    )
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: policy.portfolioId,
        asOf: "2026-08-28T02:00:00.000Z",
        events: [event],
        policies: [policy],
        dependencies: missingSelection
      }),
    /selection policy ref does not resolve/
  );

  const mismatchedMarketPolicy = runtimePolicy({ enabledMarkets: ["US"] });
  const mismatchedMarketEvent = createPortfolioPolicyActivatedEvent({
    policy: mismatchedMarketPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: mismatchedMarketPolicy.portfolioId,
        asOf: "2026-08-28T02:00:00.000Z",
        events: [mismatchedMarketEvent],
        policies: [mismatchedMarketPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /scheduled boundary markets must exactly match enabled markets/
  );
});

test("replacement changes turnover window semantics only at the current window boundary", () => {
  const currentPolicy = runtimePolicy();
  const replacementPolicy = runtimePolicy({
    version: "v2",
    name: "Hourly turnover policy",
    turnoverDurationSeconds: 3_600
  });
  const current = createPortfolioPolicyActivatedEvent({
    policy: currentPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z"
  });
  const midWindowReplacement = createPortfolioPolicyActivatedEvent({
    policy: replacementPolicy,
    activationSequence: 2,
    supersedesActivationId: current.activationId,
    createdAt: "2026-08-28T12:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: currentPolicy.portfolioId,
        asOf: "2026-08-28T12:00:00.000Z",
        events: [current, midWindowReplacement],
        policies: [currentPolicy, replacementPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /turnover window semantics can change only at both window boundaries/
  );

  const boundaryReplacement = createPortfolioPolicyActivatedEvent({
    policy: replacementPolicy,
    activationSequence: 2,
    supersedesActivationId: current.activationId,
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: currentPolicy.portfolioId,
      asOf: "2026-08-29T00:00:00.000Z",
      events: [current, boundaryReplacement],
      policies: [currentPolicy, replacementPolicy],
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    boundaryReplacement.activationId
  );

  const hourlyCurrent = createPortfolioPolicyActivatedEvent({
    policy: replacementPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z"
  });
  const insideDailyReplacement = createPortfolioPolicyActivatedEvent({
    policy: currentPolicy,
    activationSequence: 2,
    supersedesActivationId: hourlyCurrent.activationId,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: currentPolicy.portfolioId,
        asOf: "2026-08-28T01:00:00.000Z",
        events: [hourlyCurrent, insideDailyReplacement],
        policies: [currentPolicy, replacementPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /turnover window semantics can change only at both window boundaries/
  );
});

test("post-retirement activation preserves the last turnover window boundary", () => {
  const dailyPolicy = runtimePolicy();
  const hourlyPolicy = runtimePolicy({
    version: "v2",
    name: "Hourly turnover policy",
    turnoverDurationSeconds: 3_600
  });
  const activated = createPortfolioPolicyActivatedEvent({
    policy: dailyPolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z"
  });
  const retired = createPortfolioPolicyRetiredEvent({
    portfolioId: dailyPolicy.portfolioId,
    activationSequence: 2,
    retiredActivationId: activated.activationId,
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const midWindowReopen = createPortfolioPolicyActivatedEvent({
    policy: hourlyPolicy,
    activationSequence: 3,
    createdAt: "2026-08-28T12:00:00.000Z"
  });

  assert.throws(
    () =>
      resolveActiveRuntimePortfolioPolicyAsOf({
        portfolioId: dailyPolicy.portfolioId,
        asOf: "2026-08-28T12:00:00.000Z",
        events: [activated, retired, midWindowReopen],
        policies: [dailyPolicy, hourlyPolicy],
        dependencies: DEPENDENCY_FIXTURE.repository
      }),
    /turnover window semantics can change only at both window boundaries/
  );

  const boundaryReopen = createPortfolioPolicyActivatedEvent({
    policy: hourlyPolicy,
    activationSequence: 3,
    createdAt: "2026-08-29T00:00:00.000Z"
  });
  assert.equal(
    resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: dailyPolicy.portfolioId,
      asOf: "2026-08-29T00:00:00.000Z",
      events: [activated, retired, boundaryReopen],
      policies: [dailyPolicy, hourlyPolicy],
      dependencies: DEPENDENCY_FIXTURE.repository
    }).activation.activationId,
    boundaryReopen.activationId
  );
});

test("retirement event independently binds reason and target", () => {
  const policy = runtimePolicy();
  const activated = createPortfolioPolicyActivatedEvent({
    policy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  const retired = createPortfolioPolicyRetiredEvent({
    portfolioId: policy.portfolioId,
    activationSequence: 2,
    retiredActivationId: activated.activationId,
    reasonCode: "operator_pause",
    createdAt: "2026-08-28T02:00:00.000Z"
  });

  assert.equal(
    retired.retirementEventId,
    `portfolio_policy_retirement_${retired.activationEventHash.slice("sha256:".length)}`
  );
  assert.deepEqual(parsePortfolioPolicyActivationEvent(retired), retired);

  const reasonTamper = structuredClone(retired);
  reasonTamper.reasonCode = "different_reason";
  assert.throws(
    () => parsePortfolioPolicyActivationEvent(reasonTamper),
    /retirement event hash mismatch/
  );
});

test("activation file repository atomically deduplicates concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const firstRepository = new RuntimePortfolioPolicyActivationFileRepository(
      baseDir,
      [policy],
      DEPENDENCY_FIXTURE.repository
    );
    const secondRepository = new RuntimePortfolioPolicyActivationFileRepository(
      baseDir,
      [policy],
      DEPENDENCY_FIXTURE.repository
    );
    const input = {
      policy,
      createdAt: "2026-08-28T01:00:00.000Z"
    };

    const [left, right] = await Promise.all([
      firstRepository.appendActivated(input),
      secondRepository.appendActivated(input)
    ]);

    assert.deepEqual(right, left);
    assert.equal(left.activationSequence, 1);
    assert.deepEqual(await firstRepository.readAll(), [left]);
    assert.equal(
      (await readFile(
        createRuntimePortfolioPolicyActivationPaths(baseDir).eventsPath,
        "utf8"
      )).split("\n").filter(Boolean).length,
      1
    );
    assert.equal(
      (await firstRepository.resolveActiveAsOf(
        policy.portfolioId,
        "2026-08-28T01:00:00.000Z"
      )).activation.activationId,
      left.activationId
    );
  });
});

test("activation file repository serializes exact retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const fixturePath = join(baseDir, "child-fixture.json");
    const nestedBaseDir = join(baseDir, "nested", "activation");
    await writeFile(
      fixturePath,
      JSON.stringify({
        policy,
        dependencyRecords: DEPENDENCY_FIXTURE.records
      }),
      "utf8"
    );

    const [left, right] = await Promise.all([
      appendActivationFromChildProcess(fixturePath, nestedBaseDir),
      appendActivationFromChildProcess(fixturePath, nestedBaseDir)
    ]);
    const repository = new RuntimePortfolioPolicyActivationFileRepository(
      nestedBaseDir,
      [policy],
      DEPENDENCY_FIXTURE.repository
    );

    assert.deepEqual(right, left);
    assert.equal(left.activationSequence, 1);
    assert.deepEqual(await repository.readAll(), [left]);
  });
});

test("activation file repository assigns a linear sequence and converges old retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const firstPolicy = runtimePolicy();
    const secondPolicy = runtimePolicy({ version: "v2", name: "Policy v2" });
    const repository = new RuntimePortfolioPolicyActivationFileRepository(
      baseDir,
      [firstPolicy, secondPolicy],
      DEPENDENCY_FIXTURE.repository
    );
    const firstInput = {
      policy: firstPolicy,
      createdAt: "2026-08-28T01:00:00.000Z"
    };
    const first = await repository.appendActivated(firstInput);
    const replacement = await repository.appendActivated({
      policy: secondPolicy,
      supersedesActivationId: first.activationId,
      createdAt: "2026-08-29T00:00:00.000Z"
    });
    const acknowledgedLate = await repository.appendActivated(firstInput);
    const retired = await repository.appendRetired({
      portfolioId: ` ${firstPolicy.portfolioId} `,
      retiredActivationId: replacement.activationId,
      reasonCode: "operator_pause",
      createdAt: "2026-08-29T01:00:00.000Z"
    });
    const retirementRetry = await repository.appendRetired({
      portfolioId: firstPolicy.portfolioId,
      retiredActivationId: replacement.activationId,
      reasonCode: "operator_pause",
      createdAt: "2026-08-29T01:00:00.000Z"
    });

    assert.deepEqual(acknowledgedLate, first);
    assert.deepEqual(retirementRetry, retired);
    assert.equal(retired.portfolioId, firstPolicy.portfolioId);
    assert.deepEqual(
      (await repository.readAll()).map((event) => event.activationSequence),
      [1, 2, 3]
    );
    assert.equal(
      (await repository.resolveActiveAsOf(
        firstPolicy.portfolioId,
        "2026-08-29T00:30:00.000Z"
      )).policy.runtimePolicyRecordId,
      secondPolicy.runtimePolicyRecordId
    );
    await assert.rejects(
      () =>
        repository.resolveActiveAsOf(
          firstPolicy.portfolioId,
          "2026-08-29T01:00:00.000Z"
        ),
      /active runtime portfolio policy is required/
    );
  });
});

test("activation file repository fails closed for corrupt or torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const repository = new RuntimePortfolioPolicyActivationFileRepository(
      baseDir,
      [policy],
      DEPENDENCY_FIXTURE.repository
    );
    await repository.appendActivated({
      policy,
      createdAt: "2026-08-28T01:00:00.000Z"
    });
    const paths = createRuntimePortfolioPolicyActivationPaths(baseDir);
    await appendFile(paths.eventsPath, "{corrupt}\n", "utf8");
    const before = await readFile(paths.eventsPath, "utf8");

    await assert.rejects(
      () => repository.readAll(),
      /contains corrupt line 2/
    );
    await assert.rejects(
      () =>
        repository.appendActivated({
          policy,
          createdAt: "2026-08-29T00:00:00.000Z"
        }),
      /contains corrupt line 2/
    );
    assert.equal(await readFile(paths.eventsPath, "utf8"), before);

    await writeFile(paths.eventsPath, before.trimEnd(), "utf8");
    await assert.rejects(
      () => repository.readAll(),
      /torn final line/
    );

    await writeFile(
      paths.eventsPath,
      `${before.split("\n")[0]}\n\n`,
      "utf8"
    );
    await assert.rejects(
      () => repository.readAll(),
      /contains corrupt line 2/
    );
  });
});

test("activation file repository leaves an abandoned lock fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const paths = createRuntimePortfolioPolicyActivationPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new RuntimePortfolioPolicyActivationFileRepository(
      baseDir,
      [policy],
      DEPENDENCY_FIXTURE.repository,
      { lockTimeoutMs: 20, lockRetryDelayMs: 500 }
    );

    const startedAt = Date.now();
    await assert.rejects(
      () => repository.readAll(),
      /repository lock is unavailable/
    );
    assert.ok(Date.now() - startedAt < 250);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("activation file repository durably creates a nested storage directory", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const nestedBaseDir = join(baseDir, "portfolio", "activation");
    const repository = new RuntimePortfolioPolicyActivationFileRepository(
      nestedBaseDir,
      [policy],
      DEPENDENCY_FIXTURE.repository
    );

    const event = await repository.appendActivated({
      policy,
      createdAt: "2026-08-28T01:00:00.000Z"
    });

    assert.deepEqual(await repository.readAll(), [event]);
  });
});

test("runtime policy repository durably appends, reads, and converges exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const repository = new RuntimePortfolioPolicyFileRepository(
      baseDir,
      DEPENDENCY_FIXTURE.repository
    );

    assert.deepEqual(await repository.readAll(), []);
    assert.deepEqual(await repository.append(policy), policy);
    assert.deepEqual(await repository.append(structuredClone(policy)), policy);
    assert.deepEqual(await repository.readAll(), [policy]);

    const paths = createRuntimePortfolioPolicyPaths(baseDir);
    assert.equal(
      paths.recordsPath,
      join(baseDir, "runtime-portfolio-policy-records.jsonl")
    );
    assert.equal(
      (await readFile(paths.recordsPath, "utf8")).trim().split("\n").length,
      1
    );
  });
});

test("runtime policy repository persists the canonical JSON view of signed zero", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const signedZeroPolicy = structuredClone(runtimePolicy());
    const shortTerm = signedZeroPolicy.strategyBuckets.find(
      (bucket) => bucket.bucket === "short_term"
    );
    assert.ok(shortTerm !== undefined);
    shortTerm.minWeightRatio = -0;
    const policy = parseRuntimePortfolioPolicyRecord(signedZeroPolicy);
    assert.equal(Object.is(shortTerm.minWeightRatio, -0), true);
    const repository = new RuntimePortfolioPolicyFileRepository(
      baseDir,
      DEPENDENCY_FIXTURE.repository
    );

    const stored = await repository.append(policy);
    const storedShortTerm = stored.strategyBuckets.find(
      (bucket) => bucket.bucket === "short_term"
    );
    assert.ok(storedShortTerm !== undefined);
    assert.equal(Object.is(storedShortTerm.minWeightRatio, -0), false);
    assert.deepEqual(await repository.append(runtimePolicy()), stored);
    assert.deepEqual(await repository.readAll(), [stored]);
  });
});

test("runtime policy repository serializes concurrent exact appends", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const nestedBaseDir = join(baseDir, "runtime", "policies");
    const first = new RuntimePortfolioPolicyFileRepository(
      nestedBaseDir,
      DEPENDENCY_FIXTURE.repository
    );
    const second = new RuntimePortfolioPolicyFileRepository(
      nestedBaseDir,
      DEPENDENCY_FIXTURE.repository
    );

    const results = await Promise.all([
      first.append(policy),
      second.append(structuredClone(policy))
    ]);

    assert.deepEqual(results, [policy, policy]);
    assert.deepEqual(await first.readAll(), [policy]);
  });
});

test("runtime policy repository serializes exact retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const fixturePath = join(baseDir, "runtime-policy-fixture.json");
    const nestedBaseDir = join(baseDir, "runtime", "policies");
    await writeFile(
      fixturePath,
      JSON.stringify({
        policy,
        dependencyRecords: DEPENDENCY_FIXTURE.records
      }),
      "utf8"
    );

    const results = await Promise.all([
      appendRuntimePolicyFromChildProcess(fixturePath, nestedBaseDir),
      appendRuntimePolicyFromChildProcess(fixturePath, nestedBaseDir)
    ]);

    assert.deepEqual(results, [policy, policy]);
    const repository = new RuntimePortfolioPolicyFileRepository(
      nestedBaseDir,
      DEPENDENCY_FIXTURE.repository
    );
    assert.deepEqual(await repository.readAll(), [policy]);
  });
});

test("runtime policy repository rejects semantic ID collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new RuntimePortfolioPolicyFileRepository(
      baseDir,
      DEPENDENCY_FIXTURE.repository
    );
    await repository.append(runtimePolicy());

    await assert.rejects(
      repository.append(
        runtimePolicy({ createdAt: "2026-08-28T00:00:01.000Z" })
      ),
      /record ID collision/
    );
  });
});

test("runtime policy repository fails closed on torn, blank, duplicate, and tampered lines", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const paths = createRuntimePortfolioPolicyPaths(baseDir);
    const repository = new RuntimePortfolioPolicyFileRepository(
      baseDir,
      DEPENDENCY_FIXTURE.repository
    );

    await writeFile(paths.recordsPath, JSON.stringify(policy), "utf8");
    await assert.rejects(repository.readAll(), /torn final line/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(policy)}\n\n`,
      "utf8"
    );
    await assert.rejects(repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(policy)}\n${JSON.stringify(policy)}\n`,
      "utf8"
    );
    await assert.rejects(repository.readAll(), /duplicate record ID/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify({ ...policy, sourcePolicyHash: "0".repeat(64) })}\n`,
      "utf8"
    );
    await assert.rejects(repository.readAll(), /corrupt line 1/);
  });
});

test("runtime policy repository revalidates immutable dependency lineage", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const emptyDependencies = new ImmutablePolicyDependencyRepository({
      selectionPolicies: [],
      riskParameters: [],
      riskRuleSets: [],
      drawdownSemantics: [],
      sessionCalendars: [],
      scheduleBoundaries: []
    });
    const repository = new RuntimePortfolioPolicyFileRepository(
      baseDir,
      emptyDependencies
    );

    await assert.rejects(
      repository.append(policy),
      /selection policy ref does not resolve/
    );
  });
});

test("runtime policy repository treats an abandoned lock as unavailable", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createRuntimePortfolioPolicyPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new RuntimePortfolioPolicyFileRepository(
      baseDir,
      DEPENDENCY_FIXTURE.repository,
      { lockTimeoutMs: 20, lockRetryDelayMs: 500 }
    );

    const startedAt = Date.now();
    await assert.rejects(repository.readAll(), /lock is unavailable/);
    assert.ok(Date.now() - startedAt < 250);
  });
});

test("policy activation snapshot retries after the policy generation advances", async () => {
  const stalePolicy = runtimePolicy({ portfolioId: "paper-stale" });
  const activePolicy = runtimePolicy({
    portfolioId: "paper-current",
    version: "v2",
    name: "Current policy"
  });
  const activation = createPortfolioPolicyActivatedEvent({
    policy: activePolicy,
    activationSequence: 1,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
  let policyReadCount = 0;
  let activationReadCount = 0;

  const snapshot =
    await readConsistentRuntimePortfolioPolicyActivationSnapshot({
      readPolicies: async () => {
        policyReadCount += 1;
        return policyReadCount === 1
          ? [stalePolicy]
          : [stalePolicy, activePolicy];
      },
      readEvents: async (policies) => {
        activationReadCount += 1;
        if (
          !policies.some(
            (policy) =>
              policy.runtimePolicyRecordId === activePolicy.runtimePolicyRecordId
          )
        ) {
          throw new Error(
            "activated runtime portfolio policy record does not resolve"
          );
        }
        return [activation];
      }
    });

  assert.equal(policyReadCount, 2);
  assert.equal(activationReadCount, 2);
  assert.equal(snapshot.policies.at(-1)?.policyHash, activePolicy.policyHash);
  assert.equal(snapshot.events[0], activation);
});

test("policy activation snapshot keeps stable activation corruption fail-closed", async () => {
  const policy = runtimePolicy();
  let policyReadCount = 0;
  let activationReadCount = 0;

  await assert.rejects(
    readConsistentRuntimePortfolioPolicyActivationSnapshot({
      readPolicies: async () => {
        policyReadCount += 1;
        return [policy];
      },
      readEvents: async () => {
        activationReadCount += 1;
        throw new Error("stable activation corruption");
      }
    }),
    /stable activation corruption/
  );

  assert.equal(policyReadCount, 2);
  assert.equal(activationReadCount, 1);
});

test("portfolio compliance reads bucket bands from the active stored policy hash", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    const activation = await storeActivePolicyArtifacts(baseDir, policy);
    const paths = createStoragePaths(baseDir);
    await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
      portfolioId: policy.portfolioId,
      cashKrw: 300_000,
      positions: [
        position("005930", "long_term", 100_000),
        position("000660", "swing", 250_000),
        position("035420", "short_term", 300_000),
        position("252670", "hedge", 50_000, "inverse")
      ],
      updatedAt: "2026-08-28T02:00:00.000Z"
    });

    const view = await readDashboardPortfolioComplianceViewModel(baseDir);
    const rows = new Map(view.bucketCompliance.map((row) => [row.bucket, row]));

    assert.equal(view.policyStatus, "active");
    assert.equal(view.activePolicy?.policyHash, policy.policyHash);
    assert.equal(view.activePolicy?.version, policy.version);
    assert.equal(view.activePolicy?.activationId, activation.activationId);
    assert.equal(view.sourceStatus.policyArtifacts, "ok");
    assert.equal(rows.get("long_term")?.minWeightRatio, 0.2);
    assert.equal(rows.get("long_term")?.targetWeightRatio, 0.35);
    assert.equal(rows.get("long_term")?.maxWeightRatio, 0.5);
    assert.equal(rows.get("long_term")?.currentWeightRatio, 0.1);
    assert.ok(Math.abs((rows.get("long_term")?.gapRatio ?? 1) - 0.25) < 1e-12);
    assert.equal(rows.get("long_term")?.status, "under");
    assert.ok(Math.abs((rows.get("swing")?.gapRatio ?? 1) + 0.05) < 1e-12);
    assert.equal(rows.get("swing")?.status, "ok");
    assert.equal(rows.get("short_term")?.status, "over");
    assert.equal(rows.get("intraday")?.status, "ok");
    assert.equal(view.cashCompliance.targetCashRatio, 0.15);
    assert.equal(view.cashCompliance.minimumCashReserveKrw, 150_000);
    assert.equal(view.status, "breach");
    assert.equal(
      view.warnings.some((warning) => warning.includes("policy targets")),
      false
    );
  });
});

test("portfolio compliance fails closed when stored active policy lineage is corrupt", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    await storeActivePolicyArtifacts(baseDir, policy);
    const paths = createStoragePaths(baseDir);
    await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
      portfolioId: policy.portfolioId,
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-08-28T02:00:00.000Z"
    });
    const policyPaths = createRuntimePortfolioPolicyPaths(baseDir);
    await writeFile(
      policyPaths.recordsPath,
      `${JSON.stringify({ ...policy, sourcePolicyHash: "0".repeat(64) })}\n`,
      "utf8"
    );

    const view = await readDashboardPortfolioComplianceViewModel(baseDir);

    assert.equal(view.policyStatus, "invalid");
    assert.equal(view.activePolicy, null);
    assert.equal(view.sourceStatus.policyArtifacts, "corrupt");
    assert.equal(view.status, "breach");
    assert.equal(
      view.bucketCompliance.every(
        (row) =>
          row.status === "missing_policy" &&
          row.minWeightRatio === null &&
          row.targetWeightRatio === null &&
          row.maxWeightRatio === null &&
          row.gapRatio === null
      ),
      true
    );
  });
});

test("portfolio compliance rejects an offsetless portfolio as-of timestamp", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const policy = runtimePolicy();
    await storeActivePolicyArtifacts(baseDir, policy);
    const paths = createStoragePaths(baseDir);
    await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
      portfolioId: policy.portfolioId,
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-08-28T02:00:00"
    });

    const view = await readDashboardPortfolioComplianceViewModel(baseDir);

    assert.equal(view.policyStatus, "invalid");
    assert.equal(view.activePolicy, null);
    assert.equal(view.sourceStatus.policyArtifacts, "corrupt");
    assert.equal(view.status, "breach");
  });
});

async function storeActivePolicyArtifacts(
  baseDir: string,
  policy: RuntimePortfolioPolicyRecord
): Promise<PortfolioPolicyActivatedEvent> {
  const dependencyPaths = createImmutablePolicyDependencyPaths(baseDir);
  const records = DEPENDENCY_FIXTURE.records;
  await Promise.all([
    writeJsonl(dependencyPaths.selectionPolicies, records.selectionPolicies),
    writeJsonl(dependencyPaths.riskParameters, records.riskParameters),
    writeJsonl(dependencyPaths.riskRuleSets, records.riskRuleSets),
    writeJsonl(dependencyPaths.drawdownSemantics, records.drawdownSemantics),
    writeJsonl(dependencyPaths.sessionCalendars, records.sessionCalendars),
    writeJsonl(dependencyPaths.scheduleBoundaries, records.scheduleBoundaries)
  ]);
  await new RuntimePortfolioPolicyFileRepository(
    baseDir,
    DEPENDENCY_FIXTURE.repository
  ).append(policy);
  return new RuntimePortfolioPolicyActivationFileRepository(
    baseDir,
    [policy],
    DEPENDENCY_FIXTURE.repository
  ).appendActivated({
    policy,
    createdAt: "2026-08-28T01:00:00.000Z"
  });
}

async function writeJsonl(
  path: string,
  records: readonly unknown[]
): Promise<void> {
  await writeFile(
    path,
    records.length === 0
      ? ""
      : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
}

function position(
  symbol: string,
  strategyBucket: StrategyBucket,
  marketValueKrw: number,
  assetClass: "equity" | "inverse" = "equity"
) {
  return {
    market: "KR" as const,
    symbol,
    assetClass,
    strategyBucket,
    quantity: 1,
    averagePriceKrw: marketValueKrw,
    marketValueKrw,
    updatedAt: "2026-08-28T02:00:00.000Z"
  };
}

function rehashActivatedEvent(
  event: PortfolioPolicyActivatedEvent,
  changes: Partial<
    Pick<
      PortfolioPolicyActivatedEvent,
      "effectiveFrom" | "policyLineageHash" | "portfolioId"
    >
  >
): PortfolioPolicyActivatedEvent {
  const {
    activationId: _activationId,
    activationEventHash: _activationEventHash,
    createdAt,
    ...originalPayload
  } = event;
  const payload = { ...originalPayload, ...changes };
  const activationEventHash = hashCanonicalPayload(payload);
  return {
    ...payload,
    activationId: hashDerivedId(
      "portfolio_policy_activation",
      activationEventHash
    ),
    activationEventHash,
    createdAt
  };
}

function dependencyFixture() {
  const selections = new Map(
    BUCKETS.map((bucket) => [
      bucket,
      createBucketSelectionPolicyRecord({
        bucket,
        version: `selection.${bucket}.v1`,
        requiredEvidence: [
          {
            evidenceClass: "market_technical",
            sourceContractId: "verified-market-packet.v1",
            maximumAgeSeconds: 60
          }
        ],
        ...(bucket === "intraday"
          ? {
              everyTickSourceRequirement: {
                sourceContractId: "verified-market-packet.v1",
                eventType: "verified_market_packet" as const,
                maximumAgeSeconds: 60,
                dedupeKey: "packet_hash" as const
              }
            }
          : {}),
        hardGateRuleIds: ["liquidity"],
        scoringModelVersion: `selector.${bucket}.v1`,
        featureDefinitionRefs: ["momentum.v1"],
        createdAt: POLICY_CREATED_AT
      })
    ])
  );
  const buy = createPortfolioRiskRuleParameterRecord({
    ruleId: "cash_reserve",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { minimumCashRatio: 0.15 },
    createdAt: POLICY_CREATED_AT
  });
  const sell = createPortfolioRiskRuleParameterRecord({
    ruleId: "reduce_only",
    ruleVersion: "v1",
    version: "record.v1",
    parameters: { allowIncrease: false },
    createdAt: POLICY_CREATED_AT
  });
  const riskSet = createPortfolioRiskRuleSetRecord({
    version: "risk-set.v1",
    rules: [
      {
        ruleId: "cash_reserve",
        ruleVersion: "v1",
        appliesTo: ["BUY"],
        parameterRef: riskRuleParameterRefFor(buy)
      },
      {
        ruleId: "reduce_only",
        ruleVersion: "v1",
        appliesTo: ["SELL"],
        parameterRef: riskRuleParameterRefFor(sell)
      }
    ],
    createdAt: POLICY_CREATED_AT
  });
  const drawdown = createBucketDrawdownSemanticsRecord({
    version: "unit-nav.v1",
    equityBasis: "bucket_assets_plus_cash",
    unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only",
    highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark",
    emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches",
    createdAt: POLICY_CREATED_AT
  });
  const calendar = createSessionCalendarRecord({
    market: "KR",
    version: "krx.v1",
    timeZone: "Asia/Seoul",
    validFromExchangeDate: "2026-08-28",
    validThroughExchangeDate: "2026-08-28",
    sessions: [
      {
        exchangeDate: "2026-08-28",
        sessionKind: "regular",
        opensAt: "2026-08-28T09:00:00+09:00",
        closesAt: "2026-08-28T15:30:00+09:00",
        sourceEvidenceRefs: ["official-calendar:krx:2026-08-28"]
      }
    ],
    createdAt: POLICY_CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR",
    version: "daily.v1",
    timeZone: "Asia/Seoul",
    sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version,
    sessionCalendarHash: calendar.hash,
    sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily",
    anchorLocalTime: "15:30:00",
    nonSessionDayRule: "previous_session",
    createdAt: POLICY_CREATED_AT
  });
  const records: ImmutablePolicyDependencyRecords = {
    selectionPolicies: [...selections.values()],
    riskParameters: [buy, sell],
    riskRuleSets: [riskSet],
    drawdownSemantics: [drawdown],
    sessionCalendars: [calendar],
    scheduleBoundaries: [boundary]
  };
  return {
    selections,
    riskSet,
    drawdown,
    boundary,
    records,
    repository: new ImmutablePolicyDependencyRepository(records)
  };
}

function runtimePolicy(options: {
  portfolioId?: string;
  version?: string;
  name?: string;
  createdAt?: string;
  enabledMarkets?: readonly ("KR" | "US")[];
  turnoverDurationSeconds?: number;
} = {}): RuntimePortfolioPolicyRecord {
  const portfolioId = options.portfolioId ?? "paper-main";
  const version = options.version ?? "v1";
  const name = options.name ?? "Policy v1";
  const createdAt = options.createdAt ?? POLICY_CREATED_AT;
  const targets = new Map<StrategyBucket, [number, number, number]>([
    ["long_term", [0.35, 0.2, 0.5]],
    ["swing", [0.2, 0.1, 0.3]],
    ["short_term", [0.15, 0, 0.25]],
    ["intraday", [0.1, 0, 0.15]],
    ["hedge", [0.05, 0, 0.15]]
  ]);
  const strategyBuckets = BUCKETS.map((bucket) => {
    const [targetWeightRatio, minWeightRatio, maxWeightRatio] = targets.get(bucket)!;
    return {
      bucket,
      targetWeightRatio,
      minWeightRatio,
      maxWeightRatio,
      maxTurnoverRatio: 0.5,
      turnoverWindow: {
        mode: "fixed_utc" as const,
        durationSeconds: options.turnoverDurationSeconds ?? 86_400,
        anchor: "unix_epoch" as const,
        denominator: "window_open_portfolio_net_worth_krw" as const
      },
      maxDrawdownRatio: 0.1,
      drawdownSemanticsRef: drawdownSemanticsRefFor(
        DEPENDENCY_FIXTURE.drawdown
      ),
      reviewCadence:
        bucket === "intraday"
          ? ({ mode: "every_tick" as const })
          : ({
              mode: "scheduled" as const,
              boundaryRefs: [
                scheduleBoundaryRefFor(DEPENDENCY_FIXTURE.boundary)
              ]
            }),
      eventTriggers: [],
      selectionTrigger:
        minWeightRatio > 0
          ? ({ mode: "below_min" as const })
          : ({
              mode: "entry_floor_on_due_cycle" as const,
              entryWeightRatio: bucket === "short_term" ? 0.05 : 0.02
            }),
      minimumHoldingSeconds: 0,
      maximumHoldingSeconds: 86_400,
      exitPolicy: {
        takeProfit: { mode: "disabled" as const },
        timeExpiryAction: "review_required" as const
      },
      enabledMarkets: [...(options.enabledMarkets ?? ["KR" as const])],
      enabledAssetClasses: ["equity"],
      selectionPolicyRef: selectionPolicyRefFor(
        DEPENDENCY_FIXTURE.selections.get(bucket)!
      ),
      riskRuleSetRef: riskRuleSetRefFor(DEPENDENCY_FIXTURE.riskSet)
    };
  });
  const payload = {
    mode: "paper_only" as const,
    recordType: "runtime_portfolio_policy_record" as const,
    portfolioId,
    sourcePolicyRecordId: "paper_policy_source_fixture",
    sourcePolicyRecordHash: HASH_A,
    sourcePolicyHash: "c".repeat(64),
    policyId: "balanced-paper",
    version,
    name,
    strategyBuckets,
    cashPolicy: {
      targetCashRatio: 0.15,
      minimumCashReserveKrw: 100_000,
      ruleSource: "static" as const
    },
    hedgePolicy: {
      hedgeEnabled: true,
      hedgeTargetRatio: 0.05,
      maxCostRatio: 0.02
    },
    exposurePolicy: {
      maxSymbolExposureRatio: 0.2,
      maxCountryExposureRatio: 0.8,
      maxCurrencyExposureRatio: 0.8
    },
    legacyReduceOnlyPolicy: {
      allowBuyOrIncrease: false as const,
      maximumParticipationRatio: 0.1,
      riskRuleSetRef: riskRuleSetRefFor(DEPENDENCY_FIXTURE.riskSet)
    }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId(
    "runtime_portfolio_policy",
    policyHash
  );
  return parseRuntimePortfolioPolicyRecord({
    ...payload,
    runtimePolicyRecordId,
    policyHash,
    lineageHash: hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: runtimePolicyRecordId,
      semanticHash: policyHash,
      createdAt
    }),
    createdAt
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-activation-repository-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

async function appendActivationFromChildProcess(
  fixturePath: string,
  baseDir: string
): Promise<PortfolioPolicyActivatedEvent> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { ImmutablePolicyDependencyRepository } from "./dist/portfolio/runtimePolicyDependencyResolver.js";
    import { RuntimePortfolioPolicyActivationFileRepository } from "./dist/portfolio/runtimePortfolioPolicyActivationFiles.js";
    const fixture = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new RuntimePortfolioPolicyActivationFileRepository(
      process.argv[2],
      [fixture.policy],
      new ImmutablePolicyDependencyRepository(fixture.dependencyRecords)
    );
    const event = await repository.appendActivated({
      policy: fixture.policy,
      createdAt: "2026-08-28T01:00:00.000Z"
    });
    process.stdout.write(JSON.stringify(event));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, fixturePath, baseDir],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`activation child failed (${code}): ${stderr}`));
        return;
      }
      try {
        resolve(parsePortfolioPolicyActivationEvent(JSON.parse(stdout)) as PortfolioPolicyActivatedEvent);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function appendRuntimePolicyFromChildProcess(
  fixturePath: string,
  baseDir: string
): Promise<RuntimePortfolioPolicyRecord> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { ImmutablePolicyDependencyRepository } from "./dist/portfolio/runtimePolicyDependencyResolver.js";
    import { RuntimePortfolioPolicyFileRepository } from "./dist/portfolio/runtimePortfolioPolicyFiles.js";
    const fixture = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new RuntimePortfolioPolicyFileRepository(
      process.argv[2],
      new ImmutablePolicyDependencyRepository(fixture.dependencyRecords)
    );
    const policy = await repository.append(fixture.policy);
    process.stdout.write(JSON.stringify(policy));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, fixturePath, baseDir],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`runtime policy child failed (${code}): ${stderr}`));
        return;
      }
      try {
        resolve(parseRuntimePortfolioPolicyRecord(JSON.parse(stdout)));
      } catch (error) {
        reject(error);
      }
    });
  });
}
