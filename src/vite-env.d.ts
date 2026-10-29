/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * E4.4: reversión EXPLÍCITA del modo de exportación, fijada al compilar.
   * `VITE_TEXT_EXPORT_MODE=raster` compila el cliente con el camino raster.
   */
  readonly VITE_TEXT_EXPORT_MODE?: "raster" | "vector";
}

declare module 'vtracer-webapp/vtracer_webapp_bg.js' {
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;

  export class BinaryImageConverter {
    static new_with_string(params: string): BinaryImageConverter;
    init(): void;
    tick(): boolean;
    progress(): number;
    free(): void;
  }
}
