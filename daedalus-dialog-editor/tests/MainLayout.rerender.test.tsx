import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import MainLayout from '../src/renderer/components/MainLayout';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useUISelectionStore } from '../src/renderer/store/uiSelectionStore';

// MainLayout renders ThreeColumnLayout (and, on other views, lazy QuestEditor /
// VariableManager); stub the heavy always-mounted children so this probe
// measures MainLayout's own commit count, not its subtree.
jest.mock('../src/renderer/components/ThreeColumnLayout', () => () => null);
jest.mock('../src/renderer/components/SourceEditsPendingBanner', () => () => null);

const emptyModel = {
  dialogs: {}, functions: {}, constants: {}, variables: {},
  instances: {}, hasErrors: false, errors: []
};

/**
 * §2.2 selector hygiene: MainLayout was narrowed from whole-store destructures
 * (`useProjectStore()`) to per-field selectors (`projectPath`,
 * `mergedSemanticModel`, `loadQuestData`). Flipping an unrelated project field
 * (`isIngesting`) must therefore no longer re-render it; a selected field
 * (`projectPath`) still does. Fails against the pre-fix whole-store subscription.
 */
describe('MainLayout re-render granularity', () => {
  beforeEach(() => {
    useUISelectionStore.setState({ activeView: 'dialog' } as never);
    useProjectStore.setState({
      projectPath: '/proj',
      mergedSemanticModel: { ...emptyModel },
      isIngesting: false,
      isLoading: false
    } as never);
  });

  it('does not re-render when an unrelated project field (isIngesting) flips', () => {
    let commits = 0;
    render(
      <React.Profiler id="main" onRender={() => { commits += 1; }}>
        <MainLayout filePath={null} />
      </React.Profiler>
    );
    const afterMount = commits;

    act(() => { useProjectStore.setState({ isIngesting: true } as never); });
    expect(commits).toBe(afterMount);

    // A field MainLayout does select (projectPath) still re-renders it.
    act(() => { useProjectStore.setState({ projectPath: '/other' } as never); });
    expect(commits).toBeGreaterThan(afterMount);
  });
});
