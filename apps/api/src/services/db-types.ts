import type { DatabaseInstance } from '@packages/db';

/** A database handle or an open transaction, so services can join a caller's transaction. */
export type DbExecutor =
  | DatabaseInstance
  | Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];
