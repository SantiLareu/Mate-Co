import type { MaskCandidate, MaskMetrics, MaskScore } from './types';

export function scoreMask(metrics: MaskMetrics): MaskScore {
  let value = 100;
  const penalties: string[] = [];
  const penalize = (amount: number, explanation: string) => {
    value -= amount;
    penalties.push(explanation);
  };

  if (metrics.blackPercentage < .25) penalize(82, 'La máscara está prácticamente vacía.');
  else if (metrics.blackPercentage < 1) penalize(58, 'La máscara contiene muy poca información grabable.');
  else if (metrics.blackPercentage < 2.5) penalize(24, 'La cobertura negra es muy baja.');

  if (metrics.blackPercentage > 95) penalize(88, `La máscara está casi completamente negra (${metrics.blackPercentage.toFixed(0)}%).`);
  else if (metrics.blackPercentage > 88) penalize(68, `La cobertura negra es excesiva (${metrics.blackPercentage.toFixed(0)}%).`);
  else if (metrics.blackPercentage > 78) penalize(42, `La cobertura negra es demasiado alta (${metrics.blackPercentage.toFixed(0)}%).`);

  if (metrics.largestComponentTouchesBorder && metrics.largestComponentPercentage > 68) {
    penalize(52, `Una masa conectada al borde ocupa ${metrics.largestComponentPercentage.toFixed(0)}% de la imagen.`);
  } else if (metrics.largestComponentTouchesBorder && metrics.largestComponentPercentage > 42) {
    penalize(27, `La masa principal es grande y está conectada al borde (${metrics.largestComponentPercentage.toFixed(0)}%).`);
  }

  if (metrics.borderCoveragePercentage > 88) penalize(48, `${metrics.borderCoveragePercentage.toFixed(0)}% del borde pertenece a una masa negra.`);
  else if (metrics.borderCoveragePercentage > 68) penalize(30, `El borde negro es excesivo (${metrics.borderCoveragePercentage.toFixed(0)}%).`);
  else if (metrics.borderCoveragePercentage > 45) penalize(14, `Una parte importante del borde quedó marcada (${metrics.borderCoveragePercentage.toFixed(0)}%).`);

  // Fragmentation is judged by where the ink lives, not just by component count:
  // structural line-art holds most ink in long contours (low tiny-ink share),
  // while speckle noise spreads its ink across tiny components (high share).
  const noisyInk = metrics.tinyComponentInkPercentage >= 30;
  const sparseInk = !noisyInk && metrics.tinyComponentInkPercentage >= 15;
  if (metrics.smallComponentCount > 500) {
    if (noisyInk) penalize(38, 'La máscara está extremadamente fragmentada.');
    else if (sparseInk) penalize(22, 'Hay una cantidad muy alta de ruido aislado.');
    else penalize(10, 'Hay bastante detalle fragmentado para revisar.');
  } else if (metrics.smallComponentCount > 180) {
    if (noisyInk) penalize(22, 'Hay una cantidad muy alta de ruido aislado.');
    else penalize(10, 'Hay bastante detalle fragmentado para revisar.');
  } else if (metrics.smallComponentCount > 80) penalize(10, 'Hay bastante detalle fragmentado para revisar.');

  value = Math.max(0, Math.round(value));
  const summary = penalties.length
    ? `Penalizada: ${penalties[0]}`
    : 'Buena separación entre fondo y contenido según las métricas.';
  return { value, summary, penalties };
}

const recommendationPriority: Record<MaskCandidate['strategy'], number> = {
  alpha: 0,
  luminance: 2,
  'luminance-inverted': 2,
  'background-aware': 3,
  edge: 1,
  'auto-graphic': 5,
  'photo-engraving': 4,
  'illustration-stencil': 4,
};

export function recommendCandidate(candidates: MaskCandidate[]) {
  return candidates.reduce<MaskCandidate | undefined>((best, candidate) => {
    if (!best || candidate.score.value > best.score.value) return candidate;
    if (candidate.score.value === best.score.value && recommendationPriority[candidate.strategy] > recommendationPriority[best.strategy]) return candidate;
    return best;
  }, undefined);
}
