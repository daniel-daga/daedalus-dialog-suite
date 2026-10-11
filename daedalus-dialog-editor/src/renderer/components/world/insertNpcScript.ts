import type { SemanticModel } from '../../../shared/types';

/**
 * The pure half of "Insert NPC from the World surface" (level-editor.md
 * §16.19, slice 16 A): which function a world's spawns belong in, which
 * parsed file holds it, and the model edit that appends one.
 *
 * The engine spawns a world's NPCs from a *function* named after the world
 * file — `STARTUP_NEWWORLD` for `NewWorld.zen` — and retail keeps every such
 * function in one `Startup.d`, beside its `INIT_` twin that runs on every
 * load. `Wld_InsertNpc` belongs in the former, so the `INIT_` name is never
 * a fallback here. Retail's own `STARTUP_NewWorld` holds no spawn itself and
 * only delegates to `STARTUP_NewWorld_Part_*`; the append still goes to
 * `STARTUP_<world>`, accepted rather than guessing a part.
 */

export function startupFunctionFor(worldPath: string): string {
  const base = worldPath.split(/[\\/]/).pop() ?? worldPath;
  return `STARTUP_${base.replace(/\.zen$/i, '').toUpperCase()}`;
}

export type FunctionFileRefusal =
  | { kind: 'no-project' }
  | { kind: 'no-startup-function'; functionName: string }
  | { kind: 'parse-errors'; filePath: string };

export type FunctionFileResult =
  | { ok: true; filePath: string; functionName: string; model: SemanticModel }
  | { ok: false; refusal: FunctionFileRefusal };

/**
 * The parsed file declaring `functionName` (Daedalus is case-insensitive, so
 * the match is too), with the name as the file spells it. `parse-errors` wins
 * over a match: the generator refuses an errored model, and this is where
 * that refusal becomes visible instead of a throw.
 */
export function findFunctionFile(
  parsedFiles: ReadonlyMap<string, { semanticModel: SemanticModel }>,
  functionName: string,
): FunctionFileResult {
  if (parsedFiles.size === 0) return { ok: false, refusal: { kind: 'no-project' } };

  const wanted = functionName.toUpperCase();
  for (const [filePath, { semanticModel }] of parsedFiles) {
    const declared = Object.keys(semanticModel.functions).find((name) => name.toUpperCase() === wanted);
    if (!declared) continue;
    if (semanticModel.hasErrors) return { ok: false, refusal: { kind: 'parse-errors', filePath } };
    return { ok: true, filePath, functionName: declared, model: semanticModel };
  }
  return { ok: false, refusal: { kind: 'no-startup-function', functionName } };
}

/**
 * A new model with `Wld_InsertNpc (npcInstance, "spawnPoint");` as the last
 * statement of `functionName`. The action is a plain object, not a parser
 * class instance: the model crosses the `saveFile` IPC as JSON.
 */
export function appendInsertNpc(
  model: SemanticModel,
  functionName: string,
  npcInstance: string,
  spawnPoint: string,
): SemanticModel {
  const fn = model.functions[functionName];
  return {
    ...model,
    functions: {
      ...model.functions,
      [functionName]: {
        ...fn,
        actions: [...fn.actions, { type: 'InsertNpcAction', npcInstance, spawnPoint }],
      },
    },
  };
}
