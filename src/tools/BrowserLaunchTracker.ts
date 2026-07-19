export class BrowserLaunchTracker<T extends { close(): Promise<void> }> {
  private pending = new Set<Promise<T>>();
  private cancelled = new WeakSet<Promise<T>>();

  get size(): number {
    return this.pending.size;
  }

  track(_key: string, launch: Promise<T>): Promise<T> {
    this.pending.add(launch);
    return launch;
  }

  release(_key: string, launch: Promise<T>): void {
    this.pending.delete(launch);
  }

  wasCancelled(launch: Promise<T>): boolean {
    return this.cancelled.has(launch);
  }

  async closeAllPending(): Promise<void> {
    const pending = [...this.pending];
    await Promise.all(
      pending.map(async (launch) => {
        this.cancelled.add(launch);
        try {
          const context = await launch;
          await context.close().catch(() => {});
        } catch {}
      })
    );
  }
}
