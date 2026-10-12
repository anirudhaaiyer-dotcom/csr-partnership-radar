'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  ['/', 'Priorities'],
  ['/research', 'Research'],
  ['/outreach', 'Outreach'],
  ['/companies', 'Companies'],
  ['/settings', 'Settings'],
  ['/health', 'System health'],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {ITEMS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
