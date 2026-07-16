import type { Provider } from '../providers/index.js';
import { createProvider } from '../providers/index.js';
import type { AurixConfig } from './Config.js';
import type {
  ResearchEvent,
  ResearchDepth,
  Claim,
  Source,
  DebateRound,
  ClaimVerdict,
} from './research/types.js';
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
import {
  formatStructuredOutput,
  STRUCTURED_OUTPUT_PROMPT,
} from '../utils/StructuredOutputFormat.js';
import { webSearchTool } from '../tools/WebSearch.js';

const DEPTH_AGENTS: Record<ResearchDepth, string[]> = {
  low: [],
  medium: ['RequestAnalyzer', 'ResearchAgent', 'WriterAgent'],
  high: [
    'RequestAnalyzer',
    'PlanningAgent',
    'ResearchAgent',
    'VideoAgent',
    'ClaimExtractor',
    'SupporterAgent',
    'SkepticAgent',
    'JudgeAgent',
    'CitationGuardian',
    'WriterAgent',
  ],
  xhigh: [
    'RequestAnalyzer',
    'PlanningAgent',
    'ResearchAgent',
    'VideoAgent',
    'ClaimExtractor',
    'SupporterAgent',
    'SkepticAgent',
    'DebateSystem',
    'JudgeAgent',
    'CitationGuardian',
    'WriterAgent',
  ],
  max: [
    'RequestAnalyzer',
    'PlanningAgent',
    'ResearchAgent',
    'VideoAgent',
    'ClaimExtractor',
    'SupporterAgent',
    'SkepticAgent',
    'DebateSystem',
    'JudgeAgent',
    'CitationGuardian',
    'LogicCritic',
    'WriterAgent',
  ],
  ultra: [
    'RequestAnalyzer',
    'PlanningAgent',
    'ResearchAgent',
    'VideoAgent',
    'ClaimExtractor',
    'SupporterAgent',
    'SkepticAgent',
    'DebateSystem',
    'JudgeAgent',
    'CitationGuardian',
    'LogicCritic',
    'WriterAgent',
    'FinalReviewer',
  ],
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

  private setAbortSignal(signal?: AbortSignal): void {
    [
      this.requestAnalyzer,
      this.planningAgent,
      this.researchAgent,
      this.videoAgent,
      this.claimExtractor,
      this.supporter,
      this.skeptic,
      this.debateSystem,
      this.judge,
      this.citationGuardian,
      this.logicCritic,
      this.writer,
      this.finalReviewer,
    ].forEach((agent) => agent.setAbortSignal(signal));
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('Research interrupted.');
  }

  private webQueries(query: string, mode: ResearchDepth): string[] {
    const base = query.replace(/^\[[^\]]+\]\s*/, '').trim();
    const queries = [base];
    if (/benchmark|model|grok|claude|gpt|gemini|llm|ai/i.test(base)) {
      queries.push(`${base} official announcement benchmark`);
      queries.push(`${base} independent benchmark results`);
    }
    if (['xhigh', 'max', 'ultra'].includes(mode)) queries.push(`${base} latest news release`);
    return [...new Set(queries)].slice(0, mode === 'medium' ? 2 : 4);
  }

  private sourcesFromSearch(raw: string): Source[] {
    const sources: Source[] = [];
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const url = lines[i].trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const title = (lines[i - 1] || url).replace(/^\d+\.\s*/, '').trim() || url;
      const snippet = (lines[i + 1] || '').trim();
      sources.push({ title, url, snippet, reliability: 'medium' });
    }
    return sources;
  }

  private effectiveDepth(query: string, requestedMode: ResearchDepth): ResearchDepth {
    const lower = query.toLowerCase();
    const explicitResearch =
      /\b(research|riset|research dulu|web search|web_search|webfetch|web fetch|search web|benchmark|benchmarks?|sources?|citation|rilis|released?|launch(?:ed)?)\b/i.test(
        query
      );
    const heavyResearch =
      /\b(scientific|jurnal|journal|paper|literature review|systematic review|meta-analysis|academic|clinical|market analysis|analisa market|financial model|forecast|forecasting|due diligence|risk analysis|competitive intelligence|thesis|whitepaper|comprehensive report|publication-grade|multi-source investigation|investigasi mendalam)\b/i.test(
        lower
      );
    const lightweightLookup =
      /\b(kapan|when|tanggal|date|rilis|released?|launch(?:ed)?|hari ini|latest|baru|web search|web_search|webfetch|cek|check|cari)\b/i.test(
        lower
      );

    if (requestedMode === 'low' && explicitResearch) return 'medium';
    if (!heavyResearch && lightweightLookup) return 'medium';
    return requestedMode;
  }

  async *run(
    query: string,
    depth?: ResearchDepth,
    signal?: AbortSignal
  ): AsyncGenerator<ResearchEvent> {
    this.setAbortSignal(signal);
    this.throwIfAborted(signal);
    const requestedMode = depth || (this.config.researchMode as ResearchDepth) || 'low';
    const mode = this.effectiveDepth(query, requestedMode);
    const active = new Set(DEPTH_AGENTS[mode] || []);

    yield {
      type: 'agent_start',
      agent: 'Pipeline',
      data: `Research depth: ${mode} | Active agents: ${active.size}`,
    };

    if (mode === 'low') {
      yield {
        type: 'agent_start',
        agent: 'Direct',
        data: 'Single-agent mode — answering directly',
      };
      const messages = [
        {
          role: 'system' as const,
          content: `You are AURIX, an AI research assistant. Answer clearly and accurately.\n\n${STRUCTURED_OUTPUT_PROMPT}`,
        },
        { role: 'user' as const, content: query },
      ];
      const res = await this.provider.chat(messages, undefined, signal);
      yield { type: 'text', agent: 'Direct', data: formatStructuredOutput(res.text, 'terminal') };
      yield { type: 'agent_end', agent: 'Direct', data: 'Done' };
      return;
    }

    // Step 1: Analyze request
    let analysis: any = {};
    if (active.has('RequestAnalyzer')) {
      yield { type: 'agent_start', agent: 'RequestAnalyzer', data: 'Analyzing request...' };
      analysis = await this.requestAnalyzer.analyze(query);
      this.throwIfAborted(signal);
      yield {
        type: 'agent_end',
        agent: 'RequestAnalyzer',
        data: `Intent: ${analysis.intent} | Format: ${analysis.format} | Complexity: ${analysis.complexity}`,
      };
    }

    // Step 2: Plan
    if (active.has('PlanningAgent')) {
      yield { type: 'agent_start', agent: 'PlanningAgent', data: 'Creating research plan...' };
      const plan = await this.planningAgent.plan(query, analysis);
      yield {
        type: 'agent_end',
        agent: 'PlanningAgent',
        data: `Plan: ${plan.agents.join(', ') || 'direct research'}`,
      };
    }

    // Step 3: Research
    let findings: string[] = [];
    let sources: Source[] = [];
    if (active.has('ResearchAgent')) {
      const queries = this.webQueries(query, mode);
      for (const webQuery of queries) {
        yield { type: 'agent_start', agent: 'web_search', data: webQuery };
        const raw = await webSearchTool.execute({ query: webQuery, max_results: 6 });
        this.throwIfAborted(signal);
        const webSources = this.sourcesFromSearch(raw);
        sources = [...sources, ...webSources];
        if (webSources.length > 0) {
          findings.push(
            `Web search for "${webQuery}" returned ${webSources.length} source(s): ${webSources
              .slice(0, 3)
              .map((s) => s.title)
              .join('; ')}`
          );
        } else {
          findings.push(`Web search for "${webQuery}" returned no parseable sources.`);
        }
        yield {
          type: 'finding',
          agent: 'web_search',
          data: `${webSources.length} source(s) found for: ${webQuery}`,
        };
        yield { type: 'agent_end', agent: 'web_search', data: 'Search complete' };
      }

      yield {
        type: 'agent_start',
        agent: 'ResearchAgent',
        data: 'Synthesizing searched sources...',
      };
      const research = await this.researchAgent.research(
        `${query}\n\nSearched sources:\n${sources
          .slice(0, 12)
          .map(
            (s, i) =>
              `${i + 1}. ${s.title}${s.url ? ` — ${s.url}` : ''}${s.snippet ? ` — ${s.snippet}` : ''}`
          )
          .join('\n')}`,
        analysis.topics || []
      );
      findings = [...findings, ...research.findings];
      sources = [...sources, ...research.sources];
      yield {
        type: 'finding',
        agent: 'ResearchAgent',
        data: `${findings.length} findings, ${sources.length} sources`,
      };
      yield { type: 'agent_end', agent: 'ResearchAgent', data: 'Research complete' };
    }

    // Step 4: Video analysis (if video context detected)
    if (
      active.has('VideoAgent') &&
      analysis.topics?.some((t: string) => /video|youtube|tiktok/i.test(t))
    ) {
      yield { type: 'agent_start', agent: 'VideoAgent', data: 'Analyzing video content...' };
      const videoResult = await this.videoAgent.analyze(query);
      findings = [...findings, ...videoResult.claims];
      yield {
        type: 'agent_end',
        agent: 'VideoAgent',
        data: `${videoResult.claims.length} claims extracted`,
      };
    }

    // Step 5: Extract claims
    let claims: Claim[] = [];
    if (active.has('ClaimExtractor') && findings.length > 0) {
      yield { type: 'agent_start', agent: 'ClaimExtractor', data: 'Classifying claims...' };
      claims = await this.claimExtractor.extract(findings);
      yield {
        type: 'claim',
        agent: 'ClaimExtractor',
        data: `${claims.length} claims: ${claims
          .map((c) => c.type)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ')}`,
      };
      yield { type: 'agent_end', agent: 'ClaimExtractor', data: 'Classification complete' };
    }

    // Step 6: Debate (supporter + skeptic)
    const debates: DebateRound[] = [];
    const verdicts: ClaimVerdict[] = [];

    if (active.has('DebateSystem') && claims.length > 0) {
      const topClaims = claims.slice(0, 3);

      for (const claim of topClaims) {
        yield {
          type: 'agent_start',
          agent: 'SupporterAgent',
          data: `Building case FOR: "${claim.text.slice(0, 60)}..."`,
        };
        const supportResult = await this.supporter.support(claim, findings);
        yield { type: 'agent_end', agent: 'SupporterAgent', data: 'Argument constructed' };

        yield {
          type: 'agent_start',
          agent: 'SkepticAgent',
          data: `Challenging: "${claim.text.slice(0, 60)}..."`,
        };
        const skepticResult = await this.skeptic.attack(claim, findings);
        yield { type: 'agent_end', agent: 'SkepticAgent', data: 'Objections raised' };

        yield {
          type: 'debate',
          agent: 'DebateSystem',
          data: `Debating: "${claim.text.slice(0, 60)}..."`,
        };
        const debateResult = await this.debateSystem.debate(
          claim.text,
          supportResult.raw,
          skepticResult.raw
        );
        debates.push(debateResult);
        yield { type: 'debate', agent: 'DebateSystem', data: `Winner: ${debateResult.winner}` };

        // Step 7: Judge
        if (active.has('JudgeAgent')) {
          yield {
            type: 'agent_start',
            agent: 'JudgeAgent',
            data: `Issuing verdict on: "${claim.text.slice(0, 60)}..."`,
          };
          const verdict = await this.judge.judge(claim.text, debateResult, findings);
          verdicts.push(verdict);
          yield {
            type: 'verdict',
            agent: 'JudgeAgent',
            data: `${verdict.verdict} (confidence: ${verdict.confidence}%)`,
          };
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
        yield {
          type: 'verdict',
          agent: 'JudgeAgent',
          data: `${verdict.verdict}: "${claim.text.slice(0, 60)}..."`,
        };
      }
    }

    // Step 8: Citation verification
    if (active.has('CitationGuardian') && sources.length > 0) {
      yield {
        type: 'agent_start',
        agent: 'CitationGuardian',
        data: `Verifying ${sources.length} sources...`,
      };
      const verification = await this.citationGuardian.verify(sources, findings.join('\n'));
      yield {
        type: 'agent_end',
        agent: 'CitationGuardian',
        data: `${verification.verified.length} verified, ${verification.flagged.length} flagged`,
      };
    }

    // Step 9: Logic check
    if (active.has('LogicCritic') && verdicts.length > 0) {
      yield { type: 'agent_start', agent: 'LogicCritic', data: 'Checking reasoning...' };
      const logicResult = await this.logicCritic.critique(verdicts, findings.join('\n'));
      yield {
        type: 'agent_end',
        agent: 'LogicCritic',
        data: `Logic score: ${logicResult.score}/100`,
      };
    }

    // Step 10: Write output
    this.throwIfAborted(signal);
    let output = '';
    if (active.has('WriterAgent')) {
      yield { type: 'agent_start', agent: 'WriterAgent', data: 'Composing response...' };
      const writeVerdicts =
        verdicts.length > 0
          ? verdicts
          : claims.map((c) => ({
              claim: c.text,
              verdict: 'UNSOURCED' as const,
              reasoning: 'No formal verdict at this depth.',
              confidence: c.confidence,
            }));
      output = await this.writer.write(
        query,
        writeVerdicts,
        sources,
        mode,
        analysis.format || 'DETAILED',
        findings
      );
      this.throwIfAborted(signal);
      yield { type: 'agent_end', agent: 'WriterAgent', data: 'Response composed' };
    } else {
      output = findings.join('\n\n');
    }

    // Step 11: Final review (ultra mode)
    if (active.has('FinalReviewer')) {
      yield { type: 'agent_start', agent: 'FinalReviewer', data: 'Running final quality check...' };
      const review = await this.finalReviewer.review(query, output);
      if (!review.approved) {
        yield {
          type: 'agent_end',
          agent: 'FinalReviewer',
          data: `Score: ${review.score}/100 — issues found, revising`,
        };
        output +=
          '\n\n[Note: Final review flagged quality concerns. Consider increasing research depth.]';
      } else {
        yield {
          type: 'agent_end',
          agent: 'FinalReviewer',
          data: `Approved (score: ${review.score}/100)`,
        };
      }
    }

    yield { type: 'text', agent: 'Pipeline', data: formatStructuredOutput(output, 'terminal') };
    yield { type: 'agent_end', agent: 'Pipeline', data: 'Research complete' };
  }
}
