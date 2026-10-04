import { promises as dns } from 'node:dns';

/** The only DNS lookups tenancy needs. Injectable so tests never touch the network. */
export interface DnsVerifier {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'ENOENT']);

async function lookup<T>(run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch (error) {
    // "No such record" is an answer, not a failure.
    if (NOT_FOUND.has((error as { code?: string }).code ?? '')) return [];
    throw error;
  }
}

/** Resolves through the system resolver. It only ever asks for records; it never connects to the domain. */
export const systemDnsVerifier: DnsVerifier = {
  resolveTxt: (name) => lookup(() => dns.resolveTxt(name)),
  resolveCname: (name) => lookup(() => dns.resolveCname(name)),
};
