import { postJson } from "./apiClient.js";

export const pendingSimulationBatchStorageKey =
  "tossTrading.pendingSimulationBatchId";

const limits = {
  maxBatchRuns: 20,
  maxCodexCallsPerRun: 31
};

const previewDefaults = {
  runType: "single_replay",
  runCount: 1,
  sourceDataDir: "data/tossinvest-daily-global-broad-2024-01-01-2026-06-17",
  universePreset: "global_broad",
  windowMode: "random_month",
  windowSeed: "paper-sim-seed-001",
  startAt: "2024-01-01",
  endAt: "2026-06-17",
  windowMonths: 1,
  market: "mixed_global",
  initialCashKrw: 10000000,
  decisionFrequency: "once_per_day",
  maxDecisionCalls: 5,
  stepSeconds: 86400,
  maxCodexCallsPerRun: 0,
  aiProvider: "dry_run_fixture",
  aiModel: "gpt-5.3-codex-spark",
  riskProfile: "conservative",
  exitPolicy: "none",
  costModel: "standard",
  benchmarkPolicy: "cash_equal_weight_initial_hold"
};

export function bindSimulationFormControls() {
  const form = document.getElementById("simulation-config-form");
  const preview = document.getElementById("simulation-config-preview");
  const submitButton = document.querySelector("[data-simulation-submit]");
  const submitStatus = document.querySelector("[data-simulation-submit-status]");
  if (!(form instanceof HTMLFormElement) || !(preview instanceof HTMLElement)) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitSimulationRun(form, submitButton, submitStatus);
  });
  form.addEventListener("input", () => renderSimulationPreview(form, preview));
  form.addEventListener("change", () => renderSimulationPreview(form, preview));
  bindInfoHints(form);

  document.querySelectorAll("[data-simulation-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      applySimulationPreset(form, button.getAttribute("data-simulation-preset"));
      renderSimulationPreview(form, preview);
    });
  });

  renderSimulationPreview(form, preview);
}

function bindInfoHints(form) {
  const closeOtherHints = (activeHint) => {
    form.querySelectorAll(".info-hint.is-open").forEach((hint) => {
      if (hint !== activeHint) {
        hint.classList.remove("is-open");
      }
    });
  };

  form.querySelectorAll(".info-hint").forEach((hint) => {
    hint.addEventListener("pointerenter", () => {
      closeOtherHints(hint);
      hint.classList.add("is-open");
    });
    hint.addEventListener("pointerleave", () => {
      hint.classList.remove("is-open");
    });
    hint.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    hint.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeOtherHints(hint);
      hint.classList.add("is-open");
      if (hint instanceof HTMLElement) {
        hint.focus();
      }
    });
    hint.addEventListener("focus", () => {
      closeOtherHints(hint);
      hint.classList.add("is-open");
    });
    hint.addEventListener("blur", () => {
      hint.classList.remove("is-open");
    });
    hint.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && hint instanceof HTMLElement) {
        hint.classList.remove("is-open");
        hint.blur();
      }
    });
  });
}

function renderSimulationPreview(form, preview) {
  const config = simulationConfigFromForm(form);
  preview.textContent = JSON.stringify(config, null, 2);
}

function simulationConfigFromForm(form) {
  const value = (field) => formValue(form, field) ?? previewDefaults[field];
  const numberValue = (field) => {
    const raw = value(field);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : previewDefaults[field];
  };

  const aiProvider = value("aiProvider");
  const modelId =
    aiProvider === "codex_paper_only"
      ? value("aiModel")
      : "static-decision-provider";

  return {
    mode: "paper_only",
    runType: value("runType"),
    runCount: numberValue("runCount"),
    sourceDataDir: value("sourceDataDir"),
    universe: {
      preset: value("universePreset"),
      market: value("market")
    },
    window: {
      mode: value("windowMode"),
      seed: value("windowSeed"),
      startAt: value("startAt"),
      endAt: value("endAt"),
      windowMonths: numberValue("windowMonths")
    },
    samplingPolicy: {
      decisionFrequency: value("decisionFrequency"),
      stepSeconds: numberValue("stepSeconds"),
      maxDecisionCalls: numberValue("maxDecisionCalls"),
      maxCodexCallsPerRun: numberValue("maxCodexCallsPerRun")
    },
    capital: {
      initialCashKrw: numberValue("initialCashKrw")
    },
    decisionProvider: {
      mode: aiProvider,
      modelId,
      outputSchema: "schemas/virtual-decision.schema.json"
    },
    riskProfile: value("riskProfile"),
    paperExitPolicy: value("exitPolicy"),
    costModel: value("costModel"),
    benchmarkPolicy: value("benchmarkPolicy")
  };
}

function formValue(form, field) {
  const input = form.querySelector(`[data-simulation-field="${field}"]`);
  if (
    input instanceof HTMLInputElement ||
    input instanceof HTMLSelectElement ||
    input instanceof HTMLTextAreaElement
  ) {
    return input.value;
  }
  return undefined;
}

function applySimulationPreset(form, preset) {
  const updates = {
    recentSingle: {
      runType: "single_replay",
      runCount: "1",
      sourceDataDir:
        "data/tossinvest-daily-global-broad-2024-01-01-2026-06-17",
      universePreset: "global_broad",
      windowMode: "random_month",
      windowSeed: "paper-sim-daily-2024",
      startAt: "2024-01-01",
      endAt: "2026-06-17",
      windowMonths: "1",
      market: "mixed_global",
      initialCashKrw: "10000000",
      decisionFrequency: "once_per_day",
      stepSeconds: "86400",
      maxDecisionCalls: "5",
      maxCodexCallsPerRun: "0",
      aiProvider: "dry_run_fixture",
      aiModel: "gpt-5.3-codex-spark",
      riskProfile: "conservative",
      exitPolicy: "none",
      costModel: "standard",
      benchmarkPolicy: "cash_equal_weight_initial_hold"
    },
    conservative: {
      runType: "single_replay",
      runCount: "1",
      riskProfile: "conservative",
      aiProvider: "dry_run_fixture",
      aiModel: "gpt-5.3-codex-spark",
      decisionFrequency: "once_per_week",
      maxDecisionCalls: "3",
      maxCodexCallsPerRun: "0"
    },
    balanced: {
      runType: "batch_replay",
      runCount: "5",
      riskProfile: "balanced",
      aiProvider: "dry_run_fixture",
      aiModel: "gpt-5.3-codex-spark",
      decisionFrequency: "once_per_week",
      maxDecisionCalls: "5",
      maxCodexCallsPerRun: "0"
    },
    codexPaper: {
      runType: "single_replay",
      runCount: "1",
      riskProfile: "aggressive_paper",
      aiProvider: "codex_paper_only",
      aiModel: "gpt-5.3-codex-spark",
      decisionFrequency: "once_per_day",
      maxDecisionCalls: "30",
      maxCodexCallsPerRun: "30"
    }
  }[preset];

  if (!updates) {
    return;
  }

  for (const [field, nextValue] of Object.entries(updates)) {
    const input = form.querySelector(`[data-simulation-field="${field}"]`);
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    ) {
      input.value = nextValue;
    }
  }
}

async function submitSimulationRun(form, submitButton, submitStatus) {
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = true;
  }
  setSubmitStatus(submitStatus, "Run 생성 요청 중...", "pending");

  try {
    const config = simulationConfigFromForm(form);
    const validationMessage = simulationConfigValidationMessage(config);
    if (validationMessage) {
      throw new Error(validationMessage);
    }
    const result = await postJson("/paper/simulations", config);
    rememberPendingSimulationBatchId(result.batchId ?? result.simulationRunId);
    setSubmitStatus(
      submitStatus,
      `생성됨: ${result.simulationRunId ?? result.batchId}`,
      "ok"
    );
    if (typeof result.activeUrl === "string") {
      window.location.assign(result.activeUrl);
    }
  } catch (error) {
    setSubmitStatus(submitStatus, simulationSubmitErrorMessage(error), "error");
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = false;
    }
  }
}

function rememberPendingSimulationBatchId(batchId) {
  if (typeof batchId !== "string" || batchId.trim().length === 0) {
    return;
  }
  try {
    window.sessionStorage.setItem(
      pendingSimulationBatchStorageKey,
      batchId.trim()
    );
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
}

function simulationSubmitErrorMessage(error) {
  if (error instanceof Error && error.status === 405) {
    return "Run 생성 API가 현재 서버 프로세스에 로드되지 않았습니다. dashboard 서버를 재시작해 주세요.";
  }
  return error instanceof Error ? error.message : String(error);
}

function simulationConfigValidationMessage(config) {
  if (config.runCount > limits.maxBatchRuns) {
    return `Runs는 ${limits.maxBatchRuns} 이하로 입력해 주세요.`;
  }
  if (config.samplingPolicy.maxCodexCallsPerRun > limits.maxCodexCallsPerRun) {
    return `Max Codex calls는 run당 ${limits.maxCodexCallsPerRun} 이하로 입력해 주세요.`;
  }
  return "";
}

function setSubmitStatus(node, text, status) {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  node.textContent = text;
  node.dataset.status = status;
}
