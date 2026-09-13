import type { BinaryMask } from '../types';
import type { VectorizeOptions, VectorizedPath, VectorizedResult } from './types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const degreesToRadians = (degrees: number) => degrees / 180 * Math.PI;
let vtracerModule: Promise<typeof import('vtracer-webapp/vtracer_webapp_bg.js')> | null = null;

function loadVTracer() {
  if (vtracerModule) return vtracerModule;
  vtracerModule = Promise.all([
    import('vtracer-webapp/vtracer_webapp_bg.js'),
    import('vtracer-webapp/vtracer_webapp_bg.wasm?url'),
  ]).then(async ([bindings, wasmAsset]) => {
    const imports = { './vtracer_webapp_bg.js': bindings as unknown as WebAssembly.ModuleImports };
    const response = await fetch(wasmAsset.default);
    let source: WebAssembly.WebAssemblyInstantiatedSource;
    try {
      source = await WebAssembly.instantiateStreaming(response.clone(), imports);
    } catch {
      source = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
    }
    const exports = source.instance.exports as WebAssembly.Exports & { __wbindgen_start(): void };
    bindings.__wbg_set_wasm(exports);
    exports.__wbindgen_start();
    return bindings;
  }).catch(reason => {
    vtracerModule = null;
    throw reason;
  });
  return vtracerModule;
}

function maskImageData(mask: BinaryMask) {
  const rgba = new Uint8ClampedArray(mask.data.length * 4);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    const value = mask.data[pixel] === 1 ? 0 : 255;
    const offset = pixel * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return new ImageData(rgba, mask.width, mask.height);
}

function normalizedSvg(mask: BinaryMask, source: SVGSVGElement, elapsedMilliseconds: number): VectorizedResult {
  const output = document.createElementNS(SVG_NAMESPACE, 'svg');
  const viewBox = `0 0 ${mask.width} ${mask.height}`;
  output.setAttribute('xmlns', SVG_NAMESPACE);
  output.setAttribute('viewBox', viewBox);
  const paths: VectorizedPath[] = [];
  let totalPathDataLength = 0;
  let commandCount = 0;

  for (const sourcePath of source.querySelectorAll('path')) {
    const d = sourcePath.getAttribute('d')?.trim();
    if (!d) continue;
    const transform = sourcePath.getAttribute('transform')?.trim() || undefined;
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'black');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('clip-rule', 'evenodd');
    if (transform) path.setAttribute('transform', transform);
    output.append(path);
    paths.push({ d, transform, fill: 'black', fillRule: 'evenodd' });
    totalPathDataLength += d.length;
    commandCount += d.match(/[AaCcHhLlMmQqSsTtVvZz]/g)?.length ?? 0;
  }

  const svgMarkup = new XMLSerializer().serializeToString(output);
  const warnings: string[] = [];
  if (!paths.length) warnings.push('La máscara no produjo paths vectoriales.');
  if (paths.length > 1500) warnings.push('El vector contiene demasiados paths para una edición cómoda.');
  if (commandCount > 30_000) warnings.push('El vector contiene una cantidad muy alta de comandos.');
  if (totalPathDataLength > 750_000) warnings.push('El path resultante es inusualmente complejo.');
  const diagnostics = {
    pathCount: paths.length,
    totalPathDataLength,
    commandCount,
    svgSizeBytes: new Blob([svgMarkup], { type: 'image/svg+xml' }).size,
    elapsedMilliseconds,
    warnings,
  };
  return { svgMarkup, paths, viewBox, width: mask.width, height: mask.height, pathCount: paths.length, diagnostics };
}

export async function vectorizeWithVTracer(mask: BinaryMask, options: VectorizeOptions = {}) {
  if (typeof document === 'undefined') throw new Error('VTracer requiere un entorno de navegador.');
  if (!mask.width || !mask.height || mask.data.length !== mask.width * mask.height) throw new Error('La máscara binaria tiene dimensiones inválidas.');

  const { BinaryImageConverter } = await loadVTracer();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  canvas.id = `vtracer-canvas-${token}`;
  svg.id = `vtracer-svg-${token}`;
  canvas.width = mask.width;
  canvas.height = mask.height;
  svg.setAttribute('viewBox', `0 0 ${mask.width} ${mask.height}`);
  container.hidden = true;
  container.append(canvas, svg);
  document.body.append(container);
  const context = canvas.getContext('2d');
  if (!context) {
    container.remove();
    throw new Error('Canvas 2D no está disponible para vectorizar.');
  }
  context.putImageData(maskImageData(mask), 0, 0);

  const converter = BinaryImageConverter.new_with_string(JSON.stringify({
    canvas_id: canvas.id,
    svg_id: svg.id,
    mode: options.mode ?? 'spline',
    corner_threshold: degreesToRadians(options.cornerThresholdDegrees ?? 60),
    length_threshold: options.lengthThreshold ?? 3.5,
    max_iterations: 10,
    splice_threshold: degreesToRadians(options.spliceThresholdDegrees ?? 45),
    filter_speckle: options.filterSpeckle ?? 0,
    path_precision: options.pathPrecision ?? 3,
  }));
  const startedAt = performance.now();
  try {
    converter.init();
    let done = false;
    while (!done) {
      const sliceStartedAt = performance.now();
      do {
        done = converter.tick();
      } while (!done && performance.now() - sliceStartedAt < 12);
      if (!done) await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (performance.now() - startedAt > 30_000) throw new Error('La vectorización excedió el tiempo de seguridad.');
    }
    return normalizedSvg(mask, svg, performance.now() - startedAt);
  } finally {
    converter.free();
    container.remove();
  }
}
