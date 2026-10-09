import { AuthForm } from "@/components/auth-form";
import { privateMetadata, workspaceReturn } from "@/lib/site";
export const metadata = { ...privateMetadata, title: "Sign in · Chapter" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  return (
    <AuthForm
      mode="login"
      returnTo={workspaceReturn((await searchParams).next)}
    />
  );
}
