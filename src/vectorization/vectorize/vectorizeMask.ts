import type { BinaryMask } from '../types';
import type { VectorizeOptions } from './types';
import { vectorizeWithVTracer } from './vtracerAdapter';

export function vectorizeMask(mask: BinaryMask, options?: VectorizeOptions) {
  return vectorizeWithVTracer(mask, options);
}

export type { VectorizeOptions, VectorizedDiagnostics, VectorizedPath, VectorizedResult } from './types';
