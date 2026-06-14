import type { Provider } from '../providers/index.js';
import { createProvider } from '../providers/index.js';
import type { AurixConfig } from './Config.js';
import type { ResearchEvent, ResearchDepth, Claim, Source, DebateRound, ClaimVerdict } from './research/types.js';
import { RequestAnalyzer } from './research/RequestAnalyzer.js';
import { PlanningAgent } from './research/PlanningAgent.js';
import { ResearchAgent } from './research/ResearchAgent.js';
import { VideoAgent } from './research/VideoAgent.js';
import { ClaimExtractor } from './research/ClaimExtractor.js';
import { SupporterAgent } from './research/SupporterAgent.js';
import { SkepticAgent } from './research/SkepticAgent.js';
import { DebateSystem } from './research/DebateSystem.js';
import { JudgeAgent } from './research/JudgeAgent.js';
import { CitationGuardian } from './research/CitationGuardian.js';
import { LogicCritic } from './research/LogicCritic.js';
import { WriterAgent } from './research/WriterAgent.js';
import { FinalReviewer } from './research/FinalReviewer.js';

const DEPTH_AGENTS: Record<ResearchDepth, string[]> = {
  low: [],
  medium: ['RequestAnalyzer', 'ResearchAgent', 'WriterAgent'],
  high: ['RequestAnalyzer', 'PlanningAgent', 'ResearchAgent', 'VideoAgent', 'ClaimExtractor', 'SupporterAgent', 'SkepticAgent', 'JudgeAgent', 'CitationGuardian', 'WriterAgent'],
  xhigh: ['RequestAnalyzer', 'PlanningAgent', 'ResearchAgent', 'VideoAgent', 'ClaimExtractor', 'SupporterAgent', 'SkepticAgent', 'DebateSystem', 'JudgeAgent', 'CitationGuardian', 'WriterAgent'],
  max: ['RequestAnalyzer', 'PlanningAgent', 'ResearchAgent', 'VideoAgent', 'ClaimExtractor', 'SupporterAgent', 'SkepticAgent', 'DebateSystem', 'JudgeAgent', 'CitationGuardian', 'LogicCritic', 'WriterAgent'],
  ultra: ['RequestAnalyzer', 'PlanningAgent', 'ResearchAgent', 'VideoAgent', 'ClaimExtractor', 'SupporterAgent', 'SkepticAgent', 'DebateSystem', 'JudgeAgent', 'CitationGuardian', 'LogicCritic', 'WriterAgent', 'FinalReviewer'],
};

export class ResearchPipeline {
  private provider: Provider;
  private config: AurixConfig;

  private requestAnalyzer: RequestAnalyzer;
  private planningAgent: PlanningAgent;
  private researchAgent: ResearchAgent;
  private videoAgent: VideoAgent;
  private claimExtractor: ClaimExtractor;
  private supporter: SupporterAgent;
  private skeptic: SkepticAgent;
  private debateSystem: DebateSystem;
  private judge: JudgeAgent;
  private citationGuardian: CitationGuardian;
  private logicCritic: LogicCritic;
  private writer: WriterAgent;
  private finalReviewer: FinalReviewer;

  constructor(config: AurixConfig) {
    this.config = config;
    this.provider = createProvider(config);

    this.requestAnalyzer = new RequestAnalyzer(this.provider);
    this.planningAgent = new PlanningAgent(this.provider);
    this.researchAgent = new ResearchAgent(this.provider);
    this.videoAgent = new VideoAgent(this.provider);
    this.claimExtractor = new ClaimExtractor(this.provider);
    this.supporter = new SupporterAgent(this.provider);
    this.skeptic = new SkepticAgent(this.provider);
    this.debateSystem = new DebateSystem(this.provider);
    this.judge = new JudgeAgent(this.provider);
    this.citationGuardian = new CitationGuardian(this.provider);
    this.logicCritic = new LogicCritic(this.provider);
    this.writer = new WriterAgent(this.provider);
    this.finalReviewer = new FinalReviewer(this.provider);
  }

  async *run(query: string, depth?: ResearchDepth): AsyncGenerator<ResearchEvent> {
    const mode = depth || (this.config.researchMode as ResearchDepth) || 'low';
    const active = new Set(DEPTH_AGENTS[mode] || []);

    yield { type: 'agent_start', agent: 'Pipeline', data: `Research depth: ${mode} | Active agents: ${active.size}` };

    if (mode === 'low') {
      yield { type: 'agent_start', agent: 'Direct', data: 'Single-agent mode — answering directly' };
      const messages = [
        { role: 'system' as const, content: 'You are AURIX, an AI research assistant. Answer clearly and accurately.' },
        { role: 'user' as const, content: query },
      ];
      const res = await this.provider.chat(messages);
      yield { type: 'text', agent: 'Direct', data: res.text };
      yield { type: 'agent_end', agent: 'Direct', data: 'Done' };
      return;
    }

    // Step 1: Analyze request
    let analysis: any = {};
    if (active.has('RequestAnalyzer')) {
      yield { type: 'agent_start', agent: 'RequestAnalyzer', data: 'Analyzing request...' };
      analysis = await this.requestAnalyzer.analyze(query);
      yield { type: 'agent_end', agent: 'RequestAnalyzer', data: `Intent: ${analysis.intent} | Format: ${analysis.format} | Complexity: ${analysis.complexity}` };
    }

    // Step 2: Plan
    if (active.has('PlanningAgent')) {
      yield { type: 'agent_start', agent: 'PlanningAgent', data: 'Creating research plan...' };
      const plan = await this.planningAgent.plan(query, analysis);
      yield { type: 'agent_end', agent: 'PlanningAgent', data: `Plan: ${plan.agents.join(', ') || 'direct research'}` };
    }

    // Step 3: Research
    let findings: string[] = [];
    let sources: Source[] = [];
    if (active.has('ResearchAgent')) {
      yield { type: 'agent_start', agent: 'ResearchAgent', data: 'Collecting knowledge...' };
      const research = await this.researchAgent.research(query, analysis.topics || []);
      findings = research.findings;
      sources = research.sources;
      yield { type: 'finding', agent: 'ResearchAgent', data: `${findings.length} findings, ${sources.length} sources` };
      yield { type: 'agent_end', agent: 'ResearchAgent', data: 'Research complete' };
    }

    // Step 4: Video analysis (if video context detected)
    if (active.has('VideoAgent') && analysis.topics?.some((t: string) => /video|youtube|tiktok/i.test(t))) {
      yield { type: 'agent_start', agent: 'VideoAgent', data: 'Analyzing video content...' };
      const videoResult = await this.videoAgent.analyze(query);
      findings = [...findings, ...videoResult.claims];
      yield { type: 'agent_end', agent: 'VideoAgent', data: `${videoResult.claims.length} claims extracted` };
    }

    // Step 5: Extract claims
    let claims: Claim[] = [];
    if (active.has('ClaimExtractor') && findings.length > 0) {
      yield { type: 'agent_start', agent: 'ClaimExtractor', data: 'Classifying claims...' };
      claims = await this.claimExtractor.extract(findings);
      yield { type: 'claim', agent: 'ClaimExtractor', data: `${claims.length} claims: ${claims.map(c => c.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')}` };
      yield { type: 'agent_end', agent: 'ClaimExtractor', data: 'Classification complete' };
    }

    // Step 6: Debate (supporter + skeptic)
    const debates: DebateRound[] = [];
    const verdicts: ClaimVerdict[] = [];

    if (active.has('DebateSystem') && claims.length > 0) {
      const topClaims = claims.slice(0, 3);

      for (const claim of topClaims) {
        yield { type: 'agent_start', agent: 'SupporterAgent', data: `Building case FOR: "${claim.text.slice(0, 60)}..."` };
        const supportResult = await this.supporter.support(claim, findings);
        yield { type: 'agent_end', agent: 'SupporterAgent', data: 'Argument constructed' };

        yield { type: 'agent_start', agent: 'SkepticAgent', data: `Challenging: "${claim.text.slice(0, 60)}..."` };
        const skepticResult = await this.skeptic.attack(claim, findings);
        yield { type: 'agent_end', agent: 'SkepticAgent', data: 'Objections raised' };

        yield { type: 'debate', agent: 'DebateSystem', data: `Debating: "${claim.text.slice(0, 60)}..."` };
        const debateResult = await this.debateSystem.debate(claim.text, supportResult.raw, skepticResult.raw);
        debates.push(debateResult);
        yield { type: 'debate', agent: 'DebateSystem', data: `Winner: ${debateResult.winner}` };

        // Step 7: Judge
        if (active.has('JudgeAgent')) {
          yield { type: 'agent_start', agent: 'JudgeAgent', data: `Issuing verdict on: "${claim.text.slice(0, 60)}..."` };
          const verdict = await this.judge.judge(claim.text, debateResult, findings);
          verdicts.push(verdict);
          yield { type: 'verdict', agent: 'JudgeAgent', data: `${verdict.verdict} (confidence: ${verdict.confidence}%)` };
          yield { type: 'agent_end', agent: 'JudgeAgent', data: 'Verdict issued' };
        }
      }
    } else if (active.has('JudgeAgent') && claims.length > 0) {
      // No debate, but still judge top claims
      const topClaims = claims.slice(0, 3);
      for (const claim of topClaims) {
        const mockDebate: DebateRound = {
          claim: claim.text,
          supporter: `Evidence supports: ${findings.slice(0, 3).join('; ')}`,
          skeptic: 'No formal debate conducted at this depth level.',
          winner: 'draw',
        };
        const verdict = await this.judge.judge(claim.text, mockDebate, findings);
        verdicts.push(verdict);
        yield { type: 'verdict', agent: 'JudgeAgent', data: `${verdict.verdict}: "${claim.text.slice(0, 60)}..."` };
      }
    }

    // Step 8: Citation verification
    if (active.has('CitationGuardian') && sources.length > 0) {
      yield { type: 'agent_start', agent: 'CitationGuardian', data: `Verifying ${sources.length} sources...` };
      const verification = await this.citationGuardian.verify(sources, findings.join('\n'));
      yield { type: 'agent_end', agent: 'CitationGuardian', data: `${verification.verified.length} verified, ${verification.flagged.length} flagged` };
    }

    // Step 9: Logic check
    if (active.has('LogicCritic') && verdicts.length > 0) {
      yield { type: 'agent_start', agent: 'LogicCritic', data: 'Checking reasoning...' };
      const logicResult = await this.logicCritic.critique(verdicts, findings.join('\n'));
      yield { type: 'agent_end', agent: 'LogicCritic', data: `Logic score: ${logicResult.score}/100` };
    }

    // Step 10: Write output
    let output = '';
    if (active.has('WriterAgent')) {
      yield { type: 'agent_start', agent: 'WriterAgent', data: 'Composing response...' };
      const writeVerdicts = verdicts.length > 0 ? verdicts : claims.map(c => ({
        claim: c.text,
        verdict: 'UNSOURCED' as const,
        reasoning: 'No formal verdict at this depth.',
        confidence: c.confidence,
      }));
      output = await this.writer.write(query, writeVerdicts, sources, mode, analysis.format || 'DETAILED');
      yield { type: 'agent_end', agent: 'WriterAgent', data: 'Response composed' };
    } else {
      output = findings.join('\n\n');
    }

    // Step 11: Final review (ultra mode)
    if (active.has('FinalReviewer')) {
      yield { type: 'agent_start', agent: 'FinalReviewer', data: 'Running final quality check...' };
      const review = await this.finalReviewer.review(query, output);
      if (!review.approved) {
        yield { type: 'agent_end', agent: 'FinalReviewer', data: `Score: ${review.score}/100 — issues found, revising` };
        output += '\n\n[Note: Final review flagged quality concerns. Consider increasing research depth.]';
      } else {
        yield { type: 'agent_end', agent: 'FinalReviewer', data: `Approved (score: ${review.score}/100)` };
      }
    }

    yield { type: 'text', agent: 'Pipeline', data: output };
    yield { type: 'agent_end', agent: 'Pipeline', data: 'Research complete' };
  }
}
