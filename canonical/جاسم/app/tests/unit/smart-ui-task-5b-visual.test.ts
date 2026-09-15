import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_EXIT_DURATION_MS,
  isWorkspaceExit,
  isWorkspaceTransitionAnimated,
  useWorkspaceVisualLifecycle,
  workspaceSurfaceKey,
  workspaceTransitionClass,
} from '../../src/components/jasim-core/workspacePresentationVisual';

const sourcePath = resolve(
  process.cwd(),
  'src/components/jasim-core/ActiveGenerativeWorkspace.tsx',
);
const cssPath = resolve(process.cwd(), 'src/index.css');

describe('Task 5B workspace visual morphing', () => {
  it('mounts exactly one ENTER surface and does not duplicate UPDATE', () => {
    expect(workspaceTransitionClass('ENTER')).toContain('workspace-visual-enter');
    expect(workspaceSurfaceKey('ENTER', 'presentation:one')).toBe(
      'workspace-current-presentation',
    );
    expect(workspaceSurfaceKey('UPDATE', 'presentation:two')).toBe(
      'workspace-current-presentation',
    );
  });

  it('replaces the old semantic surface only for MORPH', () => {
    expect(workspaceSurfaceKey('MORPH', 'presentation:old')).not.toBe(
      workspaceSurfaceKey('MORPH', 'presentation:new'),
    );
    expect(workspaceTransitionClass('MORPH')).toContain('workspace-visual-morph');
  });

  it('makes EXIT non-actionable and leaves NO_CHANGE without animation class', () => {
    expect(isWorkspaceExit('EXIT')).toBe(true);
    expect(isWorkspaceTransitionAnimated('EXIT')).toBe(true);
    expect(isWorkspaceTransitionAnimated('NO_CHANGE')).toBe(false);
    expect(workspaceTransitionClass('NO_CHANGE')).not.toContain('visual-no_change');
    expect(workspaceTransitionClass('EXIT')).toContain('workspace-visual-exit');
  });

  it('keeps the EXIT shell temporary and cancels stale cleanup', () => {
    const visualSource = readFileSync(
      resolve(
        process.cwd(),
        'src/components/jasim-core/workspacePresentationVisual.ts',
      ),
      'utf8',
    );
    const workspaceSource = readFileSync(sourcePath, 'utf8');

    expect(WORKSPACE_EXIT_DURATION_MS).toBe(220);
    expect(visualSource).toContain('setTimeout');
    expect(visualSource).toContain('clearTimeout(timeoutId)');
    expect(visualSource).toContain('transitionTokenRef.current === transitionToken');
    expect(visualSource).toContain('[conversationId, presentationIdentity, transition]');
    expect(workspaceSource).toContain('useWorkspaceVisualLifecycle');
    expect(workspaceSource).toContain('!showExitShell');
  });

  it('keeps cleanup and focus handling presentation-only and conversation-scoped', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('workspaceSurfaceKey');
    expect(source).toContain('restoreWorkspaceFocusRef');
    expect(source).toContain('useLayoutEffect');
    expect(source).toContain('[conversationId, presentationTransition.presentationIdentity]');
    expect(source).not.toMatch(
      /useState<.*(Goal|ResultSet|Approval|Run|Transaction|Reference)/u,
    );
    expect(source).not.toMatch(/set(Goal|ResultSet|Approval|Run|Transaction|Reference)/u);
  });

  it('keeps reduced motion and one-surface disposal in the CSS contract', () => {
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.workspace-visual-exit');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('@keyframes workspaceMorph');
    expect(css).toContain('@keyframes workspaceUpdate');
  });

  it('does not encode domain-specific morph pairs', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/components/jasim-core/workspacePresentationVisual.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(
      /SEARCH_RESULTS|COMPARISON|APPROVAL|STATUS|FORM|CHECKOUT/u,
    );
    expect(source).toContain("transition === 'MORPH'");
  });
});