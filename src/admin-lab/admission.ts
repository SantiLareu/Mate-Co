/** Thin admin boundary: bounded trusted geometry import, not engraving judgement. */
import { importSvgAsset, type SvgAsset } from "./svgAssetImport";
import { importTrustedSvg } from "./svgGeometryImport";
import {
  TRUSTED_IMPORT_LIMITS,
  validateImportedGeometry,
  type ImportedGeometry,
  type TrustedImportCode,
} from "./importedGeometry";

export const ADMIN_ADMISSION_LIMITS = TRUSTED_IMPORT_LIMITS;
export type AdmissionErrorCode = TrustedImportCode | "FILE_READ_ERROR";
export interface AdmissionError {
  code: AdmissionErrorCode;
  reason: string;
}
export interface AdmittedDraft {
  geometry: ImportedGeometry;
  pathCount: number;
}
export type AdmissionOutcome =
  { ok: true; draft: AdmittedDraft } | { ok: false; error: AdmissionError };

export function fileReadErrorOutcome(): AdmissionOutcome {
  return {
    ok: false,
    error: {
      code: "FILE_READ_ERROR",
      reason: "No se pudo leer el archivo. Probá de nuevo o elegí otro SVG.",
    },
  };
}

export function admitSvgText(text: string): AdmissionOutcome {
  const imported = importTrustedSvg(text);
  if (!imported.ok)
    return {
      ok: false,
      error: { code: imported.code, reason: imported.reason },
    };
  // Same projection and recomputed bounds used for persisted art, before UI sees it.
  const checked = validateImportedGeometry(imported.geometry);
  return checked.ok
    ? {
        ok: true,
        draft: {
          geometry: checked.geometry,
          pathCount: checked.geometry.paths.length,
        },
      }
    : { ok: false, error: { code: checked.code, reason: checked.reason } };
}

export async function admitSvgFile(file: File): Promise<AdmissionOutcome> {
  // File.text() must never run for an oversized upload. Selection races belong to caller.
  if (
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    file.size > ADMIN_ADMISSION_LIMITS.MAX_FILE_BYTES
  ) {
    return {
      ok: false,
      error: { code: "LIMIT", reason: "El archivo SVG es demasiado grande." },
    };
  }
  try {
    return admitSvgText(await file.text());
  } catch {
    return fileReadErrorOutcome();
  }
}

/** Asset admission (model v3): sanitized full-SVG document, not controlled
 * geometry. Geometry admission above stays untouched for v1/v2. */
export type AssetAdmissionErrorCode =
  "SECURITY" | "TECHNICAL" | "MALFORMED" | "LIMIT" | "FILE_READ_ERROR";
export interface AssetAdmissionError {
  code: AssetAdmissionErrorCode;
  reason: string;
}
export interface AdmittedAssetDraft {
  /** Repository asset-input candidate: saveNew({ name, category, asset }). */
  asset: SvgAsset;
}
export type AssetAdmissionOutcome =
  | { ok: true; draft: AdmittedAssetDraft }
  | { ok: false; error: AssetAdmissionError };

export function fileReadErrorAssetOutcome(): AssetAdmissionOutcome {
  return {
    ok: false,
    error: {
      code: "FILE_READ_ERROR",
      reason: "No se pudo leer el archivo. Probá de nuevo o elegí otro SVG.",
    },
  };
}

export function admitSvgTextAsAsset(text: string): AssetAdmissionOutcome {
  const imported = importSvgAsset(text);
  if (!imported.ok) {
    // Los fallos del importador nunca llevan código OK (el "OK" del
    // union solo existe en la rama ok:true): se propaga tal cual.
    const code = imported.code as AssetAdmissionErrorCode;
    return { ok: false, error: { code, reason: imported.reason } };
  }
  return { ok: true, draft: { asset: imported.asset } };
}

export async function admitSvgFileAsAsset(
  file: File,
): Promise<AssetAdmissionOutcome> {
  // Same pre-read size guard as the geometry path: File.text() must never
  // run for an oversized upload. Selection races belong to caller.
  if (
    !Number.isFinite(file.size) ||
    file.size < 0 ||
    file.size > ADMIN_ADMISSION_LIMITS.MAX_FILE_BYTES
  ) {
    return {
      ok: false,
      error: { code: "LIMIT", reason: "El archivo SVG es demasiado grande." },
    };
  }
  try {
    return admitSvgTextAsAsset(await file.text());
  } catch {
    return fileReadErrorAssetOutcome();
  }
}
