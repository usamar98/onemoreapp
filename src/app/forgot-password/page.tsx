import { SecurityForm } from "@/components/security-forms";
import { privateMetadata } from "@/lib/site";
export const metadata = {
  ...privateMetadata,
  title: "Password recovery · Chapter",
  referrer: "no-referrer" as const,
};
export default function ForgotPassword() {
  return <SecurityForm mode="forgot" />;
}
