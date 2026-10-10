import { SecurityForm } from "@/components/security-forms";
import { privateMetadata } from "@/lib/site";
export const metadata = {
  ...privateMetadata,
  title: "Reset password · Chapter",
  referrer: "no-referrer" as const,
};
export default function ResetPassword() {
  return <SecurityForm mode="reset" />;
}
