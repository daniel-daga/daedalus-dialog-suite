// Favorites and categories on the asset browser (level-editor.md §16.26,
// "Wanted on top") — editor-side bookkeeping over visual *names*, in the
// idiom of `vobFolders.ts`: pure, immutable, and one parse function that does
// not trust its input.
//
// Two catalogues exist at runtime and are merged for display: the shipped
// seed (vobbilder's hand-authored tree, converted by the editor's
// `scripts/convert-vobbilder.js`) and the project's own sidecar, which holds
// only what the user added. Merging at read time rather than copying the
// seed into the sidecar keeps the sidecar a diff — a seed update reaches every
// project, and a project file never carries 1,400 names it did not write.
//
// A visual is identified by `assetKey`: the bare name without its extension,
// case-folded. The VFS lists compiled names (`NW_CRATE.MRM`), a VOB carries
// the source name (`NW_CRATE.3DS`) and vobbilder stores neither — one visual,
// three spellings, and a favourite has to hold under all of them. The name
// *stored* is whichever was given, so a tile can still ask the binding for
// exactly what it was told.

export interface AssetCategory {
  /** A path with `/` separators, as vobbilder keys them: `Items/Schwerter`. */
  path: string;
  visuals: string[];
  /**
   * The collision a visual in this category is placed with (#291): true on,
   * false off, and absent — the ordinary case — leaves it to the name rule in
   * `placementCollision.ts`. Only the project's sidecar ever carries one; the
   * seed does not, and `mergeCatalogs` lets the project's win.
   */
  collision?: boolean;
}

export interface AssetCatalog {
  favorites: string[];
  categories: AssetCategory[];
}

export function assetKey(name: string): string {
  const bare = name.slice(name.lastIndexOf('/') + 1);
  const dot = bare.lastIndexOf('.');
  return (dot <= 0 ? bare : bare.slice(0, dot)).toUpperCase();
}

export function emptyAssetCatalog(): AssetCatalog {
  return { favorites: [], categories: [] };
}

export function isFavorite(state: AssetCatalog, name: string): boolean {
  const key = assetKey(name);
  return state.favorites.some((favorite) => assetKey(favorite) === key);
}

export function toggleFavorite(state: AssetCatalog, name: string): AssetCatalog {
  const key = assetKey(name);
  return isFavorite(state, name)
    ? { ...state, favorites: state.favorites.filter((favorite) => assetKey(favorite) !== key) }
    : { ...state, favorites: [...state.favorites, name] };
}

/** Idempotent: a path already present is left where it is. */
export function createCategory(state: AssetCatalog, path: string): AssetCatalog {
  if (state.categories.some((category) => category.path === path)) return state;
  return { ...state, categories: [...state.categories, { path, visuals: [] }] };
}

/** Files `name` under `path`, creating the category if it is not there; a
 *  visual already filed (by key) is not filed twice. */
export function addToCategory(state: AssetCatalog, path: string, name: string): AssetCatalog {
  const key = assetKey(name);
  const withCategory = createCategory(state, path);
  return {
    ...withCategory,
    categories: withCategory.categories.map((category) => (
      category.path !== path || category.visuals.some((visual) => assetKey(visual) === key)
        ? category
        : { ...category, visuals: [...category.visuals, name] }
    )),
  };
}

/** `addToCategory` for many names in one change (#295) — one sidecar write
 *  for a directory's or a search's worth of visuals. Order is the caller's; a
 *  name already filed there, or given twice, is filed once. Nothing new to file
 *  answers the state it was given, so the caller can skip the write. */
export function addManyToCategory(state: AssetCatalog, path: string, names: readonly string[]): AssetCatalog {
  const withCategory = createCategory(state, path);
  const existing = withCategory.categories.find((category) => category.path === path)!;
  const keys = new Set(existing.visuals.map(assetKey));
  const fresh: string[] = [];
  for (const name of names) {
    const key = assetKey(name);
    if (keys.has(key)) continue;
    keys.add(key);
    fresh.push(name);
  }
  if (fresh.length === 0) return state;
  return {
    ...withCategory,
    categories: withCategory.categories.map((category) => (
      category.path === path ? { ...category, visuals: [...category.visuals, ...fresh] } : category
    )),
  };
}

export function removeFromCategory(state: AssetCatalog, path: string, name: string): AssetCatalog {
  const key = assetKey(name);
  return {
    ...state,
    categories: state.categories.map((category) => (
      category.path === path
        ? { ...category, visuals: category.visuals.filter((visual) => assetKey(visual) !== key) }
        : category
    )),
  };
}

/** The seed and the project's sidecar as one tree: seed categories in seed
 *  order, then the project's own; within a shared category the seed's
 *  visuals first, then the project's additions that the seed lacks. */
export function mergeCatalogs(seed: AssetCatalog, user: AssetCatalog): AssetCatalog {
  const categories = seed.categories.map((category) => ({ ...category, visuals: [...category.visuals] }));
  for (const own of user.categories) {
    const existing = categories.find((category) => category.path === own.path);
    if (existing === undefined) {
      categories.push({ ...own, visuals: [...own.visuals] });
      continue;
    }
    if (own.collision !== undefined) existing.collision = own.collision;
    const keys = new Set(existing.visuals.map(assetKey));
    for (const visual of own.visuals) {
      if (!keys.has(assetKey(visual))) {
        existing.visuals.push(visual);
        keys.add(assetKey(visual));
      }
    }
  }
  return { favorites: [...seed.favorites, ...user.favorites], categories };
}

/** Sets or, with undefined, clears a category's collision override, creating
 *  the category if it is not there — which is how a seed category gets one:
 *  the sidecar holds the path with no visuals of its own. */
export function setCategoryCollision(
  state: AssetCatalog, path: string, collision: boolean | undefined,
): AssetCatalog {
  const withCategory = createCategory(state, path);
  return {
    ...withCategory,
    categories: withCategory.categories.map((category) => {
      if (category.path !== path) return category;
      const next: AssetCategory = { path: category.path, visuals: category.visuals };
      return collision === undefined ? next : { ...next, collision };
    }),
  };
}

export function visualsOf(state: AssetCatalog, path: string): string[] {
  return state.categories.find((category) => category.path === path)?.visuals ?? [];
}

/** Defensive coercion for a catalogue read off disk — `parseVobFolders`'s
 *  rule: anything malformed collapses to the empty state, never a throw. */
export function parseAssetCatalog(raw: unknown): AssetCatalog {
  if (typeof raw !== 'object' || raw === null) return emptyAssetCatalog();
  const { favorites, categories } = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] => (
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  );
  const parsed: AssetCategory[] = [];
  if (Array.isArray(categories)) {
    for (const entry of categories) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { path, visuals, collision } = entry as Record<string, unknown>;
      if (typeof path !== 'string' || !Array.isArray(visuals)) continue;
      parsed.push({ path, visuals: strings(visuals), ...(typeof collision === 'boolean' ? { collision } : {}) });
    }
  }
  return { favorites: strings(favorites), categories: parsed };
}
