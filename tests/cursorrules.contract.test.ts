import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('.cursorrules Template Contract Tests', () => {
  const templatePath = path.resolve(__dirname, '../src/cursor/cursorrules.template.md');
  const templateContent = fs.readFileSync(templatePath, 'utf-8');

  it('should mention scanning .cursor/queue/ and selecting the lowest-numbered task', () => {
    expect(templateContent).toMatch(/\.cursor\/queue\//);
    expect(templateContent).toMatch(/lowest/i);
    expect(templateContent).toMatch(/NNNN/);
  });

  it('should mention atomic move/rename to .cursor/running/ before starting work', () => {
    expect(templateContent).toMatch(/\.cursor\/running\//);
    expect(templateContent).toMatch(/move/i);
    expect(templateContent).toMatch(/atomic/i);
    expect(templateContent).toMatch(/rename/i);
  });

  it('should mention writing .cursor/status/current.json frequently and follow schema fields', () => {
    expect(templateContent).toMatch(/\.cursor\/status\/current\.json/);
    expect(templateContent).toMatch(/frequently/i);
    
    // Schema fields assertions (matching keys in the JSON block)
    expect(templateContent).toMatch(/"state":/);
    expect(templateContent).toMatch(/"percent":/);
    expect(templateContent).toMatch(/"step":/);
    expect(templateContent).toMatch(/"lastUpdate":/);
    expect(templateContent).toMatch(/"notes":/);
    expect(templateContent).toMatch(/"errors":/);
  });

  it('should mention completion behavior for success', () => {
    expect(templateContent).toMatch(/## 4\. Completion/);
    expect(templateContent).toMatch(/Success/i);
    expect(templateContent).toMatch(/\.cursor\/done\//);
    expect(templateContent).toMatch(/commit/i);
    // Flexible match for state update
    expect(templateContent).toMatch(/state:?\s*"done"/);
  });

  it('should mention completion behavior for failure', () => {
    expect(templateContent).toMatch(/Failure/i);
    expect(templateContent).toMatch(/\.cursor\/failed\//);
    expect(templateContent).toMatch(/error/i);
    // Flexible match for state update
    expect(templateContent).toMatch(/state:?\s*"failed"/);
  });

  it('should mention stale lock protocol', () => {
    expect(templateContent).toMatch(/Stale Lock Protocol/i);
    expect(templateContent).toMatch(/report/i);
    expect(templateContent).toMatch(/stale/i);
    expect(templateContent).toMatch(/overwrite/i);
    // Match "do not ... perform a silent requeue" or "no silent requeue"
    expect(templateContent).toMatch(/(not|no).*(silent requeue)/i);
  });
});
