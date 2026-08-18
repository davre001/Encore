import Link from "next/link";

type FooterProps = {
  signedIn?: boolean;
};

export default function Footer({ signedIn = false }: FooterProps) {
  return (
    <footer className="footer">
      <Link className="footer__brand" href={signedIn ? "/home" : "/"}>
        <span className="nav__glyph" aria-hidden="true" />
        Encore
      </Link>
      {signedIn ? (
        <nav className="footer__links">
          <Link href="/home">Home</Link>
          <Link href="/editor">Editor</Link>
          <Link href="/analytics">Analytics</Link>
          <Link href="/settings">Settings</Link>
          <Link href="/profile">Profile</Link>
        </nav>
      ) : (
        <nav className="footer__links">
          <Link href="/signin">Sign in</Link>
          <Link href="/signup">Sign up</Link>
        </nav>
      )}
      <p className="footer__note">The second take is the one that lands.</p>
    </footer>
  );
}
