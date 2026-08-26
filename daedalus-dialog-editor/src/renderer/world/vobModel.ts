import { buildVobTree, createVobReader, type VobReader, type VobTree } from 'zen-world';
import type { WorldSummary } from '../../shared/worldTypes';

// The derived read model behind the World surface's panels.
//
// The scene tree and the property grid both need the hierarchy and the column
// views, and both are mounted at once. Building them per component means
// walking 23,288 VOBs twice and holding two sets of column views over the same
// buffers, so they are built once per summary and cached against it.
//
// A `WeakMap` rather than a store field: this is derived data, and `worldStore`
// deliberately holds only what the worker sent (level-editor.md §7 — "the React
// state never holds the world"). Keying on the summary means a newly opened
// world gets a new model with no invalidation to remember, and the old one is
// collected with the summary it described.

export interface VobModel {
  tree: VobTree;
  reader: VobReader;
}

const cache = new WeakMap<WorldSummary, VobModel>();

export function vobModelOf(summary: WorldSummary): VobModel {
  let model = cache.get(summary);
  if (model === undefined) {
    model = { tree: buildVobTree(summary.vobIndex), reader: createVobReader(summary.vobIndex) };
    cache.set(summary, model);
  }
  return model;
}
