import { SecurityForm } from "@/components/security-forms";
import { privateMetadata } from "@/lib/site";
export const metadata = {
  ...privateMetadata,
  title: "Verify email · Chapter",
  referrer: "no-referrer" as const,
};
export default function VerifyEmail() {
  return <SecurityForm mode="verify" />;
}
