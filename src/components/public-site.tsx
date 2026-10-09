import { ArrowRight, Layers, Menu, ArrowUpRight } from "lucide-react";
import styles from "./landing.module.css";
import { currentUser } from "@/lib/db";

export function SiteBrand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Layers size={25} strokeWidth={2.1} aria-hidden="true" />
      </span>
      <span>
        chapter<span className="brand-period">.</span>
      </span>
    </span>
  );
}
const navigation = [
  ["Features", "/#features"],
  ["How It Works", "/#how-it-works"],
  ["Pricing", "/#pricing"],
  ["FAQ", "/#faq"],
];
export function SiteHeader({
  authenticated = false,
}: {
  authenticated?: boolean;
}) {
  return (
    <header className={styles.header}>
      <a href="/" aria-label="Chapter home" className={styles.logo}>
        <SiteBrand />
      </a>
      <nav aria-label="Main navigation" className={styles.desktopNav}>
        {navigation.map(([label, href]) => (
          <a key={label} href={href}>
            {label}
          </a>
        ))}
      </nav>
      <div className={styles.accountActions}>
        {authenticated ? (
          <a href="/dashboard" className={styles.smallButton}>
            Open Dashboard <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        ) : (
          <>
            <a href="/login" className={styles.login}>
              Log in
            </a>
            <a href="/signup" className={styles.smallButton}>
              Start Your Workspace <ArrowRight size={15} aria-hidden="true" />
            </a>
          </>
        )}
      </div>
      <details className={styles.mobileMenu}>
        <summary aria-label="Toggle navigation">
          <Menu size={22} aria-hidden="true" />
        </summary>
        <nav aria-label="Mobile navigation">
          {navigation.map(([label, href]) => (
            <a key={label} href={href}>
              {label}
            </a>
          ))}
          <a href="/support">Support</a>
          {!authenticated ? <a href="/login">Log in</a> : null}
        </nav>
      </details>
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerMain}>
        <div>
          <a href="/" aria-label="Chapter home">
            <SiteBrand />
          </a>
          <p>
            Keep every project ready
            <br />
            for its next chapter.
          </p>
        </div>
        <nav aria-label="Product links">
          <span>Explore</span>
          <a href="/#features">Features</a>
          <a href="/#how-it-works">How it works</a>
          <a href="/#pricing">Pricing</a>
          <a href="/demo">Example workspace</a>
        </nav>
        <nav aria-label="Help and legal">
          <span>Good to know</span>
          <a href="/support">Support</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <div className={styles.footerNote}>
          <Layers size={28} aria-hidden="true" />
          <p>
            A little space for everything
            <br />
            you want to build.
          </p>
        </div>
      </div>
      <div className={styles.footerBottom}>
        <span>© {new Date().getFullYear()} Chapter</span>
        <span>Built for the way you build.</span>
        <a href="/dashboard">
          Your workspace <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}
export async function PublicDocument({
  title,
  intro,
  children,
  authenticated: given,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
  authenticated?: boolean;
}) {
  const authenticated = given ?? !!(await currentUser().catch(() => null));
  return (
    <div className={styles.page}>
      <SiteHeader authenticated={authenticated} />
      <main id="main-content" tabIndex={-1} className={styles.document}>
        <a href="/" className={styles.textLink}>
          ← Back to Chapter
        </a>
        <h1>{title}</h1>
        <p className={styles.documentIntro}>{intro}</p>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
