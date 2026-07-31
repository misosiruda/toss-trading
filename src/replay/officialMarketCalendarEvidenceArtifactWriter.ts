import { writeExclusiveJsonArtifact } from "./exclusiveJsonArtifactWriter.js";
import {
  officialMarketCalendarEvidenceArtifactSchema,
  parseOfficialMarketCalendarEvidenceArtifact
} from "./officialMarketCalendarEvidence.js";

export async function writeOfficialMarketCalendarEvidenceArtifact(input: {
  outputPath: string;
  artifact: unknown;
}): Promise<void> {
  const parsed = officialMarketCalendarEvidenceArtifactSchema.parse(
    input.artifact
  );
  const artifact = parseOfficialMarketCalendarEvidenceArtifact(parsed, {
    asOf: parsed.generatedAt
  });
  await writeExclusiveJsonArtifact({
    outputPath: input.outputPath,
    value: artifact
  });
}
