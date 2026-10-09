import { AuthForm } from "@/components/auth-form";
import { privateMetadata, workspaceReturn } from "@/lib/site";
export const metadata = {
  ...privateMetadata,
  title: "Create your workspace · Chapter",
};
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  return (
    <AuthForm
      mode="register"
      returnTo={workspaceReturn((await searchParams).next)}
    />
  );
}
