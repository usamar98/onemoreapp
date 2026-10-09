import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { currentUser } from "@/lib/db";
import { workspaceData } from "@/lib/phase-three-api";
import { privateMetadata } from "@/lib/site";
import { Suspense } from "react";
import Loading from "@/components/workspace-loading";
import type { User } from "@/lib/types";
export const metadata = {
  ...privateMetadata,
  title: "Your workspace · Chapter",
};
export const dynamic = "force-dynamic";
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) {
    const params = await searchParams;
    const next = new URLSearchParams();
    for (const key of ["project", "invite", "billing", "tool"]) {
      const value = params[key];
      if (typeof value === "string") next.set(key, value);
    }
    redirect(
      "/login?next=" +
        encodeURIComponent("/dashboard" + (next.size ? "?" + next : "")),
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <AuthenticatedWorkspace user={user} />
    </Suspense>
  );
}
async function AuthenticatedWorkspace({ user }: { user: User }) {
  return <Dashboard initial={await workspaceData(user)} />;
}
