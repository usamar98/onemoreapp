import { Dashboard } from "@/components/dashboard";
import { currentUser, getProjects, activities, integrations } from "@/lib/db";
import { previewWorkspace } from "@/lib/demo";
import { workspaceData } from "@/lib/phase-three-api";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await currentUser();
  const workspace = user ? await workspaceData(user) : previewWorkspace;
  return <Dashboard initial={workspace} />;
}
