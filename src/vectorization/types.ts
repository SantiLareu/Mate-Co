export type RasterImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type BinaryMask = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type MaskStrategy = 'alpha' | 'luminance' | 'luminance-inverted' | 'background-aware' | 'edge' | 'auto-graphic' | 'photo-engraving' | 'illustration-stencil';

export type BackgroundTone = 'claro' | 'oscuro' | 'intermedio';

export type BackgroundAnalysis = {
  color: { red: number; green: number; blue: number };
  borderMeanLuminance: number;
  borderLuminanceVariation: number;
  borderUniformityPercentage: number;
  connectedBorderPercentage: number;
  backgroundTone: BackgroundTone;
  hasUsefulAlpha: boolean;
  contentColorSeparation: number;
  hasChromaticSeparation: boolean;
  confidence: number;
  complexBackground: boolean;
  connectedBackground: Uint8Array;
};

export type MaskMetrics = {
  blackPixels: number;
  blackPercentage: number;
  componentCount: number;
  smallComponentCount: number;
  largestComponentPercentage: number;
  borderCoveragePercentage: number;
  largestComponentTouchesBorder: boolean;
  suspicious: boolean;
  warnings: string[];
};

export type MaskCandidate = {
  strategy: MaskStrategy;
  label: string;
  description: string;
  mask: BinaryMask;
  metrics: MaskMetrics;
  score: MaskScore;
};

export type MaskScore = {
  value: number;
  summary: string;
  penalties: string[];
};

export type ClientResultLabel = 'Recomendada' | 'Más detalle' | 'Más simple';

export type SelectedMaskCandidate = {
  candidate: MaskCandidate;
  label: ClientResultLabel;
  score: number;
  selectedReason: string;
};

export type LoadedImage = {
  name: string;
  mimeType: string;
  originalDataUrl: string;
  originalWidth: number;
  originalHeight: number;
  hasTransparency: boolean;
  raster: RasterImage;
};
