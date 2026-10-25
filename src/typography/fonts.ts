/**
 * Catálogo tipográfico inicial (Etapa 4).
 *
 * Tres fuentes OFL con procedencia verificada (hash, licencia y commit en el
 * PROVENANCE.md de cada carpeta). Ninguna se recorta ni se renombra: Lato y
 * Dancing Script declaran Reserved Font Name, por lo que un subconjunto o una
 * conversión NO podrían conservar esos nombres.
 *
 * Los binarios se sirven desde `public/typography/` (copiados tal cual al
 * build): importarlos como módulos hace que Vite intente transformarlos, y un
 * .ttf no es JavaScript. La versión en la query invalida la caché cuando
 * cambie el binario.
 *
 * El binario oficial de Dancing Script se llama "DancingScript[wght].ttf"; la
 * copia local usa un nombre de fichero equivalente porque los corchetes
 * rompen la resolución de rutas. El NOMBRE INTERNO de la fuente (PostScript,
 * name table) no se modifica.
 */
export type TypographyFontId = "poppins" | "lato" | "dancing-script";

export type TypographyFont = {
  id: TypographyFontId;
  /** Nombre visible de la familia (el que vería el cliente). */
  family: string;
  /** Peso con el que se compone (600 en las tres). */
  weight: number;
  /** Variable: el peso es un eje y se puede mover. */
  variable: boolean;
  /** URL del binario. */
  url: string;
  /** Licencia (SIL OFL 1.1) y documento de procedencia. */
  licenseUrl: string;
  provenanceUrl: string;
  /** Reserved Font Name declarado por la licencia, si existe. */
  reservedFontName?: string;
};

const FONT_VERSION = "v1";

/** URL pública de un fichero del catálogo. */
function assetUrl(path: string): string {
  return `/typography/${path}?${FONT_VERSION}`;
}

export const TYPOGRAPHY_FONTS: Record<TypographyFontId, TypographyFont> = {
  poppins: {
    id: "poppins",
    family: "Poppins SemiBold",
    weight: 600,
    variable: false,
    url: assetUrl("poppins/Poppins-SemiBold.ttf"),
    licenseUrl: assetUrl("poppins/OFL.txt"),
    provenanceUrl: assetUrl("poppins/PROVENANCE.md"),
  },
  lato: {
    id: "lato",
    family: "Lato SemiBold",
    weight: 600,
    variable: false,
    url: assetUrl("lato/Lato-SemiBold.ttf"),
    licenseUrl: assetUrl("lato/OFL.txt"),
    provenanceUrl: assetUrl("lato/PROVENANCE.md"),
    reservedFontName: "Lato",
  },
  "dancing-script": {
    id: "dancing-script",
    family: "Dancing Script",
    weight: 600,
    variable: true,
    url: assetUrl("dancingscript/DancingScript-wght.ttf"),
    licenseUrl: assetUrl("dancingscript/OFL.txt"),
    provenanceUrl: assetUrl("dancingscript/PROVENANCE.md"),
    reservedFontName: "Dancing Script",
  },
};

export const TYPOGRAPHY_FONT_LIST: TypographyFont[] = [
  TYPOGRAPHY_FONTS.poppins,
  TYPOGRAPHY_FONTS.lato,
  TYPOGRAPHY_FONTS["dancing-script"],
];

const bytesCache = new Map<TypographyFontId, Promise<ArrayBuffer>>();

/** Binario de la fuente (descargado una sola vez). */
export async function loadFontBytes(id: TypographyFontId): Promise<ArrayBuffer> {
  const cached = bytesCache.get(id);
  if (cached) return cached;
  const font = TYPOGRAPHY_FONTS[id];
  if (!font) throw new Error(`Fuente desconocida: ${id}`);
  const promise = fetch(font.url).then((response) => {
    if (!response.ok) {
      throw new Error(
        `No se pudo cargar la fuente ${font.family}: HTTP ${response.status}`,
      );
    }
    return response.arrayBuffer();
  });
  bytesCache.set(id, promise);
  return promise;
}
