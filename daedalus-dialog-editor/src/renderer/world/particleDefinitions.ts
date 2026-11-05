import { particleKey, readParticleEffect, type ParticleEffect } from 'zen-world';

// A world names a particle effect; the definition is a `C_PARTICLEFX` instance
// in script source (level-editor.md §16.45, #410). This is the join between the
// two, and it is deliberately three existing calls and no new ones: the index
// says which file declares a name (`ProjectIndex.instanceFiles`), `file:read`
// reads it, `parser:parseSource` gives each instance's verbatim text, and
// `npc:extract` — which classifies any instance body by shape — gives its
// fields.
//
// A name the project does not declare stays out, and so keeps the marker it has
// today: the preview is of the definitions a modder's scripts own, never of the
// engine's compiled `.DAT`.

/** The calls a resolution makes. Structural so a test can stand in for them. */
export interface ParticleSourceApi {
  readFile(filePath: string): Promise<string>;
  parseSource(source: string): Promise<{ instances?: Record<string, { sourceText?: string }> }>;
  extractNpc(sourceText: string): Promise<{
    statements: Array<{ kind: string; field?: string; value?: string }>;
  }>;
}

/**
 * The effects `names` resolve to — `particleKey`ed, as `particleVisualNames`
 * names them — or an empty map where none do.
 *
 * One read and one parse per file: a project declares its effects in a handful
 * of files (`System/PFX/PfxInst.d` carries 181 instances), so the cost is paid
 * once per file rather than once per effect. A file that cannot be read or
 * parsed is skipped rather than reported: a broken script is the Problems
 * panel's business, and the preview falls back to the marker either way.
 */
export async function resolveParticleEffects(
  names: readonly string[],
  instanceFiles: Readonly<Record<string, string>>,
  api: ParticleSourceApi,
): Promise<Map<string, ParticleEffect>> {
  const byFile = new Map<string, string[]>();
  for (const name of names) {
    const file = instanceFiles[particleKey(name)];
    if (file === undefined) continue;
    const wanted = byFile.get(file);
    if (wanted === undefined) byFile.set(file, [name]);
    else wanted.push(name);
  }

  const effects = new Map<string, ParticleEffect>();

  await Promise.all([...byFile].map(async ([file, wanted]) => {
    let model: { instances?: Record<string, { sourceText?: string }> };
    try {
      model = await api.parseSource(await api.readFile(file));
    } catch {
      return;
    }

    // Case-insensitively, like every other lookup of a Daedalus name.
    const declared = new Map(
      Object.entries(model.instances ?? {}).map(([name, instance]) => [particleKey(name), instance]),
    );

    await Promise.all(wanted.map(async (name) => {
      const sourceText = declared.get(particleKey(name))?.sourceText;
      if (sourceText === undefined) return;

      const { statements } = await api.extractNpc(sourceText);
      const fields: Record<string, string> = {};
      for (const statement of statements) {
        if (statement.kind === 'field' && statement.field !== undefined && statement.value !== undefined) {
          fields[statement.field.toLowerCase()] = statement.value;
        }
      }

      const effect = readParticleEffect(name, fields);
      if (effect !== null) effects.set(particleKey(name), effect);
    }));
  }));

  return effects;
}
