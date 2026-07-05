export function stripTerminalControl(input: unknown): string {
  const text = String(input ?? '');
  return (
    text
      // OSC: ESC ] ... BEL / ESC \\
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
      // DCS/PM/APC/SOS: ESC P/^/_/X ... ESC \\
      .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
      // CSI: ESC [ params intermediates final
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // 8-bit CSI/OSC variants
      .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x9d[\s\S]*?(?:\x07|\x9c)/g, '')
      // Two-byte ESC sequences
      .replace(/\x1b[@-Z\\-_]/g, '')
      // C0 controls except tab/newline/carriage return
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  );
}

export function safeDisplayText(input: unknown): string {
  return stripTerminalControl(input);
}
