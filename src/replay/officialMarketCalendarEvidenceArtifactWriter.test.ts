import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeOfficialMarketCalendarEvidenceArtifact } from "./officialMarketCalendarEvidenceArtifactWriter.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";

test("official calendar evidence writer creates a verified JSON artifact", async (t) => {
  const fixture = await outputFixture(t);
  const artifact = signedArtifact();

  await writeOfficialMarketCalendarEvidenceArtifact({
    outputPath: fixture.outputPath,
    artifact
  });

  const written = await readFile(fixture.outputPath, "utf8");
  assert.equal(written.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(written), artifact);
  assert.deepEqual(await readdir(fixture.outputDirectory), [
    "official-calendar.json"
  ]);
});

test("official calendar evidence writer preserves an existing output", async (t) => {
  const fixture = await outputFixture(t);
  const existing = "existing official evidence must remain unchanged\n";
  await mkdir(fixture.outputDirectory);
  await writeFile(fixture.outputPath, existing, "utf8");

  await assert.rejects(
    writeOfficialMarketCalendarEvidenceArtifact({
      outputPath: fixture.outputPath,
      artifact: signedArtifact()
    }),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST"
  );
  assert.equal(await readFile(fixture.outputPath, "utf8"), existing);
  assert.deepEqual(await readdir(fixture.outputDirectory), [
    "official-calendar.json"
  ]);
});

test("official calendar evidence writer rejects a hash mismatch before filesystem mutation", async (t) => {
  const fixture = await outputFixture(t);
  const artifact = {
    ...signedArtifact(),
    generatedAt: "2025-03-11T22:00:00.000Z"
  };

  await assert.rejects(
    writeOfficialMarketCalendarEvidenceArtifact({
      outputPath: fixture.outputPath,
      artifact
    }),
    /artifact hash mismatch/
  );
  await assert.rejects(access(fixture.outputDirectory));
});

test("official calendar evidence writer rejects invalid source freshness before filesystem mutation", async (t) => {
  const fixture = await outputFixture(t);
  const artifact = signedArtifact();
  const staleArtifact = {
    ...artifact,
    sources: artifact.sources.map((source) => ({
      ...source,
      staleAfter: "2025-03-10T22:00:00.000Z"
    })) as OfficialMarketCalendarEvidenceArtifact["sources"]
  };

  await assert.rejects(
    writeOfficialMarketCalendarEvidenceArtifact({
      outputPath: fixture.outputPath,
      artifact: staleArtifact
    }),
    /generatedAt must be inside each source freshness window/
  );
  await assert.rejects(access(fixture.outputDirectory));
});

async function outputFixture(t: test.TestContext): Promise<{
  outputDirectory: string;
  outputPath: string;
}> {
  const directory = await mkdtemp(
    join(tmpdir(), "official-calendar-evidence-writer-")
  );
  const outputDirectory = join(directory, "nested");
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    outputDirectory,
    outputPath: join(outputDirectory, "official-calendar.json")
  };
}

function signedArtifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload = evidencePayload();
  return {
    ...payload,
    artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
  };
}

function evidencePayload(): OfficialMarketCalendarEvidencePayload {
  return {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-03-10T22:00:00.000Z",
    coverage: {
      startDate: "2025-03-10",
      endDate: "2025-03-10",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      {
        sourceId: "fixture.krx.source",
        evidenceClass: "official_exchange",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        publisher: "synthetic fixture KRX publisher",
        sourceUrl: "https://example.invalid/krx-calendar",
        sourceDocumentHash: hash("a"),
        retrievedAt: "2025-03-01T00:00:00.000Z",
        staleAfter: "2026-01-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:00",
          closeLocalTime: "15:30"
        }
      },
      {
        sourceId: "fixture.nyse.source",
        evidenceClass: "official_exchange",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        publisher: "synthetic fixture NYSE publisher",
        sourceUrl: "https://example.invalid/nyse-calendar",
        sourceDocumentHash: hash("b"),
        retrievedAt: "2025-03-01T00:00:00.000Z",
        staleAfter: "2026-01-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:30",
          closeLocalTime: "16:00"
        }
      }
    ],
    sessions: [
      {
        sessionId: "fixture.krx.2025-03-10",
        sourceId: "fixture.krx.source",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-03-10",
        sessionType: "regular",
        marketOpen: "2025-03-10T00:00:00.000Z",
        marketClose: "2025-03-10T06:30:00.000Z",
        exceptionName: null
      },
      {
        sessionId: "fixture.nyse.2025-03-10",
        sourceId: "fixture.nyse.source",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-03-10",
        sessionType: "regular",
        marketOpen: "2025-03-10T13:30:00.000Z",
        marketClose: "2025-03-10T20:00:00.000Z",
        exceptionName: null
      }
    ]
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
