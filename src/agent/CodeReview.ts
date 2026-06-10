import type { Provider, Message } from '../providers/index.js';
import { createProvider } from '../providers/index.js';
import type { AurixConfig } from './Config.js';

interface ReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  line?: number;
  description: string;
  suggestion?: string;
}

interface ReviewResult {
  reviewer: string;
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

export class CodeReviewPipeline {
  private provider: Provider;

  constructor(config: AurixConfig) {
    this.provider = createProvider(config);
  }

  async review(code: string, focus?: string): Promise<string> {
    const reviews: ReviewResult[] = [];

    if (!focus || focus === 'all' || focus === 'security') {
      reviews.push(await this.securityReview(code));
    }
    if (!focus || focus === 'all' || focus === 'performance') {
      reviews.push(await this.performanceReview(code));
    }
    if (!focus || focus === 'all' || focus === 'style') {
      reviews.push(await this.styleReview(code));
    }

    const combined = await this.compileReview(reviews, code);
    return combined;
  }

  private async securityReview(code: string): Promise<ReviewResult> {
    const result = await this.call(
      `You are a security code reviewer. Check for:
- SQL injection, XSS, command injection
- Authentication/authorization issues
- Hardcoded secrets, insecure defaults
- OWASP Top 10 vulnerabilities
- Input validation gaps
- Dependency risks

Respond with:
SCORE: <0-100>
SUMMARY: <2-3 sentence overview>
ISSUES:
[CRITICAL/HIGH/MEDIUM/LOW] <line if known>: <description>
  Fix: <suggestion>
---`,
      code
    );

    return this.parseReview('Security', result);
  }

  private async performanceReview(code: string): Promise<ReviewResult> {
    const result = await this.call(
      `You are a performance code reviewer. Check for:
- O(n²) or worse complexity where avoidable
- N+1 queries, unnecessary database calls
- Memory leaks, unbounded growth
- Missing caching opportunities
- Blocking operations that should be async
- Unnecessary allocations in hot paths

Respond with:
SCORE: <0-100>
SUMMARY: <2-3 sentence overview>
ISSUES:
[CRITICAL/HIGH/MEDIUM/LOW] <line if known>: <description>
  Fix: <suggestion>
---`,
      code
    );

    return this.parseReview('Performance', result);
  }

  private async styleReview(code: string): Promise<ReviewResult> {
    const result = await this.call(
      `You are a code style reviewer. Check for:
- Naming clarity (variables, functions, classes)
- Code organization and separation of concerns
- Function length and complexity
- Dead code and unused imports
- Consistent patterns
- Readability and maintainability

Respond with:
SCORE: <0-100>
SUMMARY: <2-3 sentence overview>
ISSUES:
[CRITICAL/HIGH/MEDIUM/LOW] <line if known>: <description>
  Fix: <suggestion>
---`,
      code
    );

    return this.parseReview('Style', result);
  }

  private async compileReview(reviews: ReviewResult[], code: string): Promise<string> {
    const allIssues = reviews.flatMap(r => r.issues);
    const avgScore = Math.round(reviews.reduce((s, r) => s + r.score, 0) / reviews.length);

    const debateInput = reviews.map(r => `${r.reviewer} (score: ${r.score}): ${r.summary}`).join('\n');

    const finalVerdict = await this.call(
      `You are a review judge. Compile multiple code reviews into a single final report.

Rules:
- Prioritize critical and high issues
- Remove duplicates across reviewers
- Resolve conflicts (if one reviewer says it's fine and another disagrees, explain both views)
- Produce a clear, actionable summary

Format:
# Code Review Report

## Overall Score: <score>/100

## Critical Issues
<must-fix issues>

## Recommendations
<improvements worth making>

## Summary
<2-3 sentence final verdict>`,
      `Reviews:\n${debateInput}\n\nAll issues (${allIssues.length}):\n${allIssues.map(i => `[${i.severity}] ${i.category}: ${i.description}`).join('\n')}`
    );

    return finalVerdict;
  }

  private parseReview(reviewer: string, text: string): ReviewResult {
    const scoreMatch = text.match(/SCORE:\s*(\d+)/);
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+?)(?=ISSUES:|$)/);
    const issues: ReviewIssue[] = [];

    const issueBlocks = text.split('---');
    for (const block of issueBlocks) {
      const m = block.match(/\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\s*(?:line\s*(\d+):)?\s*(.+)/i);
      if (m) {
        issues.push({
          severity: m[1].toLowerCase() as ReviewIssue['severity'],
          category: reviewer,
          line: m[2] ? parseInt(m[2]) : undefined,
          description: m[3].trim(),
        });
      }
    }

    return {
      reviewer,
      score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
      issues,
      summary: summaryMatch?.[1]?.trim() || 'No summary.',
    };
  }

  private async call(systemPrompt: string, userMessage: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];
    const res = await this.provider.chat(messages);
    return res.text;
  }
}
