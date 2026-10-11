import { useFileStore } from '../../store/fileStore';
import { useProjectStore } from '../../store/projectStore';
import type { DialogFunction } from '../../types/global';

/**
 * Resolve a single function by name for an action renderer, subscribing only to
 * that function's reference — not to the whole semantic model.
 *
 * Mode split (hidden from callers):
 *  - Single-file mode: the target function lives in the edited file's own model
 *    (`openFiles.get(filePath).semanticModel`), which is the only source when no
 *    project is loaded and is fresher than the merged model while editing.
 *  - Project mode: fall back to the category-stable merged model.
 *
 * Because both reads select a single function reference, a card using this hook
 * re-renders only when *its* target function changes — model data no longer has
 * to cross the ActionCard memo boundary (fix-07 §2.8 option iii).
 */
export function useResolvedFunction(
  name: string | undefined,
  filePath: string | null | undefined
): DialogFunction | undefined {
  const fromFile = useFileStore((s) =>
    filePath && name ? s.openFiles.get(filePath)?.semanticModel?.functions?.[name] : undefined
  );
  const fromProject = useProjectStore((s) =>
    name ? s.mergedSemanticModel.functions?.[name] : undefined
  );
  return fromFile ?? fromProject;
}
