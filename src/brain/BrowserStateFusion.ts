import type { BrowserFusedState } from './types.js';

function truncate(value: string | undefined, max = 4000): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}\n...` : value;
}

function matchLine(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim();
}

export class BrowserStateFusion {
  private state?: BrowserFusedState;

  recordBrowserResult(args: Record<string, unknown>, result: string): void {
    const action = String(args.action || '');
    const previous = this.state || { updatedAt: new Date().toISOString() };
    const url = matchLine(result, 'URL') || (action === 'url' ? result.trim() : undefined);
    const title = matchLine(result, 'Title') || (action === 'title' ? result.trim() : undefined);
    const screenshotPath =
      result.match(
        /(?:Screenshot saved to|Screenshot saved|screenshot)[:\s]+([^\s]+\.(?:png|jpg|jpeg|webp))/i
      )?.[1] || result.match(/(\/[^\s]+\.(?:png|jpg|jpeg|webp))/i)?.[1];

    let domSummary: string | undefined;
    if (
      action === 'snapshot' ||
      result.startsWith('<body') ||
      result.includes('\nDOM snapshot:\n')
    ) {
      domSummary = result.includes('\nDOM snapshot:\n')
        ? result.split('\nDOM snapshot:\n')[1]?.split('\n\nVisible text:\n')[0]
        : result;
    }

    let textSummary: string | undefined;
    if (action === 'text') textSummary = result;
    if (result.includes('\n\nVisible text:\n'))
      textSummary = result.split('\n\nVisible text:\n')[1];

    this.state = {
      ...previous,
      session: String(args.session || previous.session || 'default'),
      url: url || previous.url,
      title: title || previous.title,
      screenshotPath: screenshotPath || previous.screenshotPath,
      domSummary: truncate(domSummary || previous.domSummary),
      textSummary: truncate(textSummary || previous.textSummary),
      updatedAt: new Date().toISOString(),
    };
  }

  getState(session?: string): BrowserFusedState | undefined {
    if (!this.state) return undefined;
    if (session && this.state.session && this.state.session !== session) return undefined;
    return { ...this.state };
  }

  renderForPrompt(maxChars = 1600): string {
    if (!this.state) return '';
    const lines = [
      '[BROWSER FUSED STATE]',
      this.state.session ? `Session: ${this.state.session}` : '',
      this.state.url ? `URL: ${this.state.url}` : '',
      this.state.title ? `Title: ${this.state.title}` : '',
      this.state.screenshotPath ? `Screenshot: ${this.state.screenshotPath}` : '',
      this.state.domSummary ? `DOM:\n${this.state.domSummary}` : '',
      this.state.textSummary ? `Visible text:\n${this.state.textSummary}` : '',
      '[/BROWSER FUSED STATE]',
    ].filter(Boolean);
    const text = lines.join('\n');
    return text.length > maxChars
      ? `${text.slice(0, maxChars)}\n...\n[/BROWSER FUSED STATE]`
      : text;
  }
}
