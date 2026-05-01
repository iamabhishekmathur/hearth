/**
 * Custom Playwright reporter that generates a comprehensive Markdown report.
 * Outputs to test-results/comprehensive-report.md
 */
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

interface TestEntry {
  suite: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'FLAKY';
  duration: number;
  error?: string;
  steps: string[];
  retry: number;
}

class MarkdownReporter implements Reporter {
  private results: TestEntry[] = [];
  private startTime = 0;
  private outputDir: string;

  constructor(options: { outputDir?: string } = {}) {
    this.outputDir = options.outputDir || path.join(process.cwd(), 'test-results');
  }

  onBegin(_config: FullConfig, _suite: Suite) {
    this.startTime = Date.now();
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const suiteName = test.parent?.title || 'Unknown';
    const steps = result.steps.map(
      (s) => `${s.title} (${s.duration}ms) ${s.error ? '-- FAILED' : ''}`,
    );

    let status: TestEntry['status'];
    if (result.status === 'passed') status = 'PASS';
    else if (result.status === 'skipped') status = 'SKIP';
    else if (result.status === 'timedOut') status = 'FAIL';
    else status = 'FAIL';

    if (result.retry > 0 && result.status === 'passed') status = 'FLAKY';

    this.results.push({
      suite: suiteName,
      title: test.title,
      status,
      duration: result.duration,
      error: result.error?.message,
      steps,
      retry: result.retry,
    });
  }

  onEnd(result: FullResult) {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.results.filter((r) => r.status === 'PASS').length;
    const failed = this.results.filter((r) => r.status === 'FAIL').length;
    const skipped = this.results.filter((r) => r.status === 'SKIP').length;
    const flaky = this.results.filter((r) => r.status === 'FLAKY').length;
    const total = this.results.length;

    const lines: string[] = [];

    // Header
    lines.push('# Hearth Comprehensive Test Report');
    lines.push('');
    lines.push(`**Date:** ${new Date().toISOString()}`);
    lines.push(`**Duration:** ${(totalDuration / 1000).toFixed(1)}s`);
    lines.push(`**Overall:** ${result.status}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total | ${total} |`);
    lines.push(`| Passed | ${passed} |`);
    lines.push(`| Failed | ${failed} |`);
    lines.push(`| Skipped | ${skipped} |`);
    lines.push(`| Flaky | ${flaky} |`);
    lines.push(`| Pass Rate | ${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}% |`);
    lines.push('');

    // Failures table
    const failures = this.results.filter((r) => r.status === 'FAIL');
    if (failures.length > 0) {
      lines.push('## Failures');
      lines.push('');
      lines.push('| Suite | Test | Error |');
      lines.push('|-------|------|-------|');
      for (const f of failures) {
        const errMsg = (f.error || 'Unknown error').split('\n')[0].slice(0, 100);
        lines.push(`| ${f.suite} | ${f.title} | ${errMsg} |`);
      }
      lines.push('');
    }

    // Group by suite
    const suites = new Map<string, TestEntry[]>();
    for (const r of this.results) {
      const list = suites.get(r.suite) || [];
      list.push(r);
      suites.set(r.suite, list);
    }

    // Detailed results by suite
    lines.push('## Detailed Results');
    lines.push('');

    for (const [suiteName, tests] of suites) {
      const suitePassed = tests.filter((t) => t.status === 'PASS').length;
      const suiteTotal = tests.length;
      lines.push(`### ${suiteName} (${suitePassed}/${suiteTotal})`);
      lines.push('');

      for (const t of tests) {
        const icon = t.status === 'PASS' ? 'PASS' : t.status === 'SKIP' ? 'SKIP' : 'FAIL';
        lines.push(`#### ${t.title} -- ${icon}`);
        lines.push('');
        lines.push(`**Duration:** ${(t.duration / 1000).toFixed(1)}s`);

        if (t.steps.length > 0) {
          lines.push('');
          lines.push('**Steps:**');
          for (const step of t.steps) {
            lines.push(`1. ${step}`);
          }
        }

        if (t.error) {
          lines.push('');
          lines.push('**Error:**');
          lines.push('```');
          lines.push(t.error.slice(0, 500));
          lines.push('```');
        }

        lines.push('');
      }
    }

    // Product enhancement opportunities
    lines.push('## Product Enhancement Opportunities');
    lines.push('');
    lines.push('> These opportunities were identified during test execution.');
    lines.push('> See individual persona scenario tests for detailed gap analysis.');
    lines.push('');
    lines.push('Refer to `e2e/personas.spec.ts` for the complete list of product gaps');
    lines.push('identified through persona-driven testing.');
    lines.push('');

    // Write file
    const outputPath = path.join(this.outputDir, 'comprehensive-report.md');
    fs.writeFileSync(outputPath, lines.join('\n'));
    console.log(`\nReport written to: ${outputPath}`);
  }
}

export default MarkdownReporter;
