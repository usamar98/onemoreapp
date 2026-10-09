import { Dashboard } from "@/components/dashboard";
import { currentUser } from "@/lib/db";
import { workspaceData } from "@/lib/phase-three-api";
import { previewWorkspace } from "@/lib/demo";
import { privateMetadata } from "@/lib/site";
import { redirect } from "next/navigation";
export const metadata = {
  ...privateMetadata,
  title: "Example workspace · Chapter",
};
export const dynamic = "force-dynamic";
export default async function Demo() {
  const user = await currentUser();
  if (user && !user.demo) redirect("/dashboard");
  // A demo session may persist its own example projects; real accounts see only the example preview here.
  return (
    <Dashboard
      initial={user?.demo ? await workspaceData(user) : previewWorkspace}
    />
  );
}
