import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SystemStatus } from '@/components/system-status';

/**
 * Landing page.
 *
 * Replace this copy with your product's. The structure is the part worth
 * keeping: one claim, one proof, one next step, in that order.
 *
 * What it deliberately avoids — these are the reflexes that make a page look
 * generated rather than designed:
 *   - a full-bleed gradient banner standing in for a real hero
 *   - a badge above the headline announcing that the product is "production ready"
 *   - three feature cards of equal weight, each with a decorative icon
 *   - emoji anywhere
 * Contrast, spacing, and type hierarchy carry the page instead.
 */

const STACK = [
  { name: 'Next.js', role: 'App Router frontend, React Server Components' },
  { name: 'Fastify', role: 'API with OpenAPI docs generated from route schemas' },
  { name: 'PostgreSQL', role: 'Drizzle ORM, typed migrations, deterministic seeds' },
  { name: 'Redis', role: 'Sessions and cache' },
  { name: 'S3-compatible storage', role: 'Uploads via MinIO locally, any S3 in production' },
  { name: 'IAM', role: 'Users, roles, groups, and allow/deny policies' },
];

export default function HomePage() {
  return (
    <>
      <section className="container flex flex-col items-start gap-6 py-20 md:py-28">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
          The boring parts, already done.
        </h1>

        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          Authentication, permissions, migrations, object storage, and API docs — wired together and
          running, so you can start on the part that is actually yours.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link href="/signup">
            <Button size="lg">Create an account</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      <section id="stack" className="border-t bg-muted/30">
        <div className="container py-20">
          <div className="max-w-xl space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">What&apos;s included</h2>
            <p className="text-muted-foreground">
              Every piece below is configured and talking to the others. Nothing here is a stub.
            </p>
          </div>

          <dl className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {STACK.map((item) => (
              <div key={item.name} className="space-y-1.5 border-t pt-4">
                <dt className="font-medium">{item.name}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{item.role}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="status" className="container py-20">
        <div className="max-w-xl space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight">Running right now</h2>
          <p className="text-muted-foreground">
            A live readiness probe against your own services. If something is not up, this is where
            you will see it first.
          </p>
        </div>

        <div className="mt-10">
          <SystemStatus />
        </div>
      </section>

      <section id="start" className="border-t">
        <div className="container flex flex-col items-start gap-6 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            Start with the first screen that is yours.
          </h2>
          <p className="max-w-xl leading-relaxed text-muted-foreground">
            Create an account to see the dashboard, the profile screen, and the IAM console this
            starter ships with — then replace them.
          </p>
          <Link href="/signup">
            <Button size="lg">Create an account</Button>
          </Link>
        </div>
      </section>
    </>
  );
}
