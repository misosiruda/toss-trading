import { readExperimentListPageData } from "@/lib/dashboardViewModels";
import { ExperimentList } from "./ExperimentList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const pageData = await readExperimentListPageData();
  return <ExperimentList pageData={pageData} />;
}
