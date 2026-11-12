/**
 * The semantic model as the renderer receives it (#541). A function's
 * `callSites` is the project index's view of its body — every call, with its
 * arguments and positions — and only the main process reads it, so it stops at
 * the IPC boundary instead of riding in every model the renderer holds.
 *
 * `calls` stays: the Problems rules and quest detection read it in the renderer.
 *
 * The input is the model the main process parsed or cached for indexing, so it
 * is copied one level deep rather than mutated.
 */
export function withoutCallSites<T extends { functions: Record<string, unknown> }>(model: T): T {
  const functions: Record<string, unknown> = {};
  for (const [name, func] of Object.entries(model.functions)) {
    const copy: Record<string, unknown> = { ...(func as Record<string, unknown>) };
    delete copy.callSites;
    functions[name] = copy;
  }
  return { ...model, functions };
}
