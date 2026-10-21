import { useEffect, useState } from "react";

/**
 * Isolated Blob-document URL for a repository-validated SVG asset string.
 *
 * Extracted as the single reusable customer-side counterpart of the admin
 * Blob preview pattern: the SVG stays a vector browser asset rendered
 * through `<image>`/`<img>`, never inlined as markup or innerHTML, so
 * internal IDs, local `href`/`url()` refs and unscoped CSS stay inside
 * their own document and need no cross-document namespacing.
 *
 * Lifetime: the object URL is revoked when the source string changes or
 * the consumer unmounts. The hook is source-tagged: while a new source has
 * no URL yet it returns null instead of the previous (already revoked) URL,
 * so a source swap renders nothing for one commit rather than one frame of
 * dead image. Only caller-supplied validated asset strings are
 * accepted — never arbitrary remote blob content.
 */
export function useApprovedAssetUrl(
  svg: string | null | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [readySource, setReadySource] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!svg) {
      setUrl(null);
      setReadySource(null);
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    setUrl(objectUrl);
    setReadySource(svg);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [svg]);

  if (readySource !== svg) return null;
  return url;
}
