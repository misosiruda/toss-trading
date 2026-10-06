import { readExperimentListPageData } from "@/lib/dashboardViewModels";
import { ExperimentList } from "./ExperimentList";
import { listDocumentNavigationBootstrap } from "@/lib/listDocumentNavigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const pageData = await readExperimentListPageData();
  return <><script dangerouslySetInnerHTML={{ __html: listDocumentNavigationBootstrap }} /><ExperimentList pageData={pageData} /></>;
}
