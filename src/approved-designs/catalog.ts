import { useEffect, useState } from "react";
import { createAdminDesignStore } from "../admin-lab/repository";
import type { RenderableDesign } from "../admin-lab/types";

/**
 * Read-only customer view of the owner's approved library.
 *
 * Single shared repository instance (the same `createAdminDesignStore` the
 * admin panel writes through): this module only ever calls `load` and
 * `subscribe` — no write methods, no catalog duplication. Only `enabled`
 * designs are exposed; the drawer decides search/category presentation.
 *
 * The library lives in same-browser/origin localStorage, so an empty list
 * on another device is expected, not an error (documented in
 * docs/approved-design-editor.md, never presented as a remote catalog).
 */

let sharedStore: ReturnType<typeof createAdminDesignStore> | null = null;

function getStore(): ReturnType<typeof createAdminDesignStore> {
  if (!sharedStore) sharedStore = createAdminDesignStore();
  return sharedStore;
}

export function useApprovedDesignCatalog(): {
  designs: RenderableDesign[];
  ready: boolean;
} {
  const [designs, setDesigns] = useState<RenderableDesign[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const store = getStore();
    let cancelled = false;
    const refresh = async () => {
      const loaded = await store.load();
      if (cancelled) return;
      setDesigns(loaded.designs.filter((design) => design.enabled));
      setReady(true);
    };
    void refresh();
    const unsubscribe = store.subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { designs, ready };
}
