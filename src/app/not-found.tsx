import Link from "next/link";
import { LockKeyhole, ArrowRight } from "lucide-react";
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="standalone-state">
      <LockKeyhole size={35} />
      <h1>This chapter is private.</h1>
      <p>
        The link may be unavailable, or the owner has chosen to keep this
        project private.
      </p>
      <Link href="/" className="button primary">
        Back to Chapter
        <ArrowRight size={16} />
      </Link>
    </main>
  );
}
