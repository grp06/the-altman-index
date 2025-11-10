import Link from 'next/link';
import styles from './navbar.module.css';

export function NavBar() {
  return (
    <div className={styles.navWrapper}>
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/" className={styles.brand}>
          The Altman Index
        </Link>
        <div className={styles.links}>
          <Link href="/about" className={styles.link}>
            About
          </Link>
        </div>
      </nav>
    </div>
  );
}
