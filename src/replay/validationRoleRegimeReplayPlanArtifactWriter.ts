import { writeExclusiveJsonArtifact } from "./exclusiveJsonArtifactWriter.js";
import { parseValidationRoleRegimeReplayPlan } from "./validationRoleRegimeReplayPlan.js";

export async function writeValidationRoleRegimeReplayPlanArtifact(input: {
  outputPath: string;
  plan: unknown;
}): Promise<void> {
  const plan = parseValidationRoleRegimeReplayPlan(input.plan);
  await writeExclusiveJsonArtifact({
    outputPath: input.outputPath,
    value: plan
  });
}
