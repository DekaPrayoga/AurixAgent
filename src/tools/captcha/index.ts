export {
  visionClassify,
  readFileBase64,
  analyzeTileCrops,
  loadCaptchaTraining,
  saveCaptchaTraining,
  getTrainingHint,
  findGridTiles,
  humanClick,
  humanMove,
  humanHold,
  warmupBehavior,
  bezierPoint,
  easeInOut,
  capthaiSolve,
  saveCapthaiTraining,
} from './common.js';
export type { CaptchaTrainingExample } from './common.js';
export { solveCaptchaGrid } from './RecaptchaSolver.js';
export {
  CapSolverClient,
  capSolverConfigured,
  createConfiguredCapSolverClient,
} from './CapSolverClient.js';
export { CAPSOLVER_TASK_TYPES, validateCapSolverTask } from './CapSolverTypes.js';
export { solveWithCapSolverFallback } from './CapSolverBrowserFallback.js';
export {
  detectAliyunCaptcha,
  classifyAliyunCaptcha,
  solveAliyunCaptcha,
  invertAliyunDragDistance,
  aliyunPieceOffset,
  buildAliyunDragTrajectory,
} from './AliyunSolver.js';
export {
  autoSolveCaptcha,
  analyzeImageChallenge,
  _lastGridAnalyzeTime,
  setLastGridAnalyzeTime,
} from './CaptchaRouter.js';
export { solveGeetestSlider } from './GeetestSolver.js';
export {
  solveHcaptcha,
  classifyHcaptchaFrames,
  isHcaptchaChallengeUrl,
  isHcaptchaCheckboxUrl,
} from './HcaptchaSolver.js';
export {
  solveTurnstile,
  detectTurnstile,
  extractTurnstileDetails,
  hasTurnstileToken,
  injectTurnstileToken,
} from './TurnstileSolver.js';
export { FuncaptchaSolver, extractPublicKey, extractServiceUrl } from './FuncaptchaSolver.js';
export type { FuncaptchaOptions, FuncaptchaSolveResult } from './FuncaptchaSolver.js';
export {
  injectA11yCookie,
  setA11yCookieFromUser,
  getA11yCookie,
  isA11yCookieValid,
  needsA11yCookieFromUser,
  agentPromptForA11yCookie,
  detectChallengeAfterClick,
  loadA11yState,
  a11yTtlSeconds,
  A11Y_STATE_PATH,
} from './HcaptchaA11y.js';
