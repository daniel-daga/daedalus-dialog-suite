// Whether a mod's source asset has been compiled (#294).
//
// ZenGin reads compiled files — `.MRM`/`.MSH` for a `.3DS`, `.MDL`/`.MDM` for
// an `.ASC`, `.MMB` for an `.MMS`, `-C.TEX` for a `.TGA` — and ZenKit reads
// nothing else. A mod's own new assets sit in its folders as sources until a
// GMBT build compiles them into `_work/Data/*/_compiled`, and the project root
// is always mounted, so the browser lists a `.3DS` whose compiled half does not
// exist yet. Previewing it then resolved to nothing, which read as "the tool is
// missing my assets" rather than as "this one is not compiled".
//
// The answer comes off the binding's `vfsResolve`, which maps a source name to
// the compiled file the mounted namespace serves — and, finding none, falls
// back to the name as given. So "it resolved" is not "it is compiled": the
// resolved name has to be a compiled one. No filesystem and no binding here;
// the caller hands in what `vfsResolve` said.

/** Source formats ZenGin compiles before it reads them. `.MDS` is left out:
 *  a model script compiles to an `.MSB` nothing here resolves, and a tag
 *  saying "not compiled" on every one of them would be false. */
const SOURCE_EXTENSIONS = ['.3DS', '.ASC', '.MMS', '.TGA'];

/** What those compile into — the only answers of `vfsResolve` that are. */
const COMPILED_EXTENSIONS = ['.MRM', '.MSH', '.MDL', '.MDM', '.MMB', '.TEX'];

export type CompileState = 'compiled' | 'uncompiled';

const fileName = (name: string) => name.slice(name.lastIndexOf('/') + 1).toUpperCase();

export function isSourceAsset(name: string): boolean {
  const upper = fileName(name);
  return SOURCE_EXTENSIONS.some((extension) => upper.endsWith(extension));
}

/** Null for a name that is not a source; otherwise whether `resolved` — what
 *  `vfsResolve` answered for it — is a compiled file. */
export function compileState(name: string, resolved: string | null): CompileState | null {
  if (!isSourceAsset(name)) return null;
  if (resolved === null) return 'uncompiled';
  const upper = fileName(resolved);
  return COMPILED_EXTENSIONS.some((extension) => upper.endsWith(extension)) ? 'compiled' : 'uncompiled';
}
