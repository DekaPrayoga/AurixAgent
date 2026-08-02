export interface OverlayState {
  permissionPrompt: boolean;
  vision: boolean;
  login: boolean;
  rewind: boolean;
  palette: boolean;
  sessions: boolean;
  connect: boolean;
  mcpLogin: boolean;
  modelPicker: boolean;
  outputPanel: boolean;
}

export function isOverlayOpen(state: OverlayState): boolean {
  return Object.values(state).some(Boolean);
}
