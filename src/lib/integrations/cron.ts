/**
 * STUB created by Agent D so src/instrumentation.ts builds. Agent C owns this
 * file and its real implementation replaces this one on merge (take C's
 * version). Contract used by the in-process scheduler: `runCronTick()` runs
 * one pass of every periodic job and resolves when done.
 */
export async function runCronTick(): Promise<unknown> {
  return { stub: true };
}
