export async function waitFor<T>(
  check: () => T | undefined | null | false,
  { timeoutMs = 5_000, intervalMs = 20, message = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
