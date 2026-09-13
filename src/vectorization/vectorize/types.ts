export type VectorizeMode = 'spline' | 'polygon' | 'none';

export type VectorizeOptions = {
  mode?: VectorizeMode;
  cornerThresholdDegrees?: number;
  lengthThreshold?: number;
  spliceThresholdDegrees?: number;
  filterSpeckle?: number;
  pathPrecision?: number;
};

export type VectorizedPath = {
  d: string;
  transform?: string;
  fill: 'black';
  fillRule: 'evenodd';
};

export type VectorizedDiagnostics = {
  pathCount: number;
  totalPathDataLength: number;
  commandCount: number;
  svgSizeBytes: number;
  elapsedMilliseconds: number;
  warnings: string[];
};

export type VectorizedResult = {
  svgMarkup: string;
  paths: VectorizedPath[];
  viewBox: string;
  width: number;
  height: number;
  pathCount: number;
  diagnostics: VectorizedDiagnostics;
};
