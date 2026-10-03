import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

/* FONTS:START — replaced wholesale when a theme is applied at generation time.
   Edit freely; just keep the markers if you want `--theme` to keep working. */
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});
/* FONTS:END */

export const metadata: Metadata = {
  title: 'Baseline',
  description: 'Full-stack starter: Next.js, Fastify, PostgreSQL, Redis, and S3-compatible storage.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      {/*
        Chrome lives in the route-group layouts, not here. `(marketing)` gets a
        public nav and footer, `(app)` gets the signed-in shell with a sidebar,
        and `(auth)` gets a bare centred frame. A single global navbar was why
        marketing content and app content used to sit on the same page.
      */}
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
