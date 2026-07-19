export function createNonInteractiveCleanup(actions: {
  saveSession(): Promise<void>;
  closeBrowsers(): Promise<void>;
}): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => {
    if (!running) {
      running = (async () => {
        await actions.saveSession().catch(() => {});
        await actions.closeBrowsers().catch(() => {});
      })();
    }
    return running;
  };
}
