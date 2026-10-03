import { Suspense } from "react";
import { ExperimentWizard } from "./ExperimentWizard";

export default function NewExperimentPage() {
  return <Suspense fallback={<p>새 실험 입력을 준비하고 있어요.</p>}><ExperimentWizard /></Suspense>;
}
