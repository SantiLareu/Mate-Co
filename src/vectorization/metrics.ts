import { connectedComponents } from './cleanup';
import type { BinaryMask, MaskMetrics } from './types';

export function calculateMaskMetrics(mask: BinaryMask): MaskMetrics {
  const total = mask.width * mask.height;
  const blackPixels = mask.data.reduce((sum, value) => sum + value, 0);
  const components = connectedComponents(mask, 1);
  const largest = components.reduce((current, component) => component.pixels.length > (current?.pixels.length ?? 0) ? component : current, undefined as typeof components[number] | undefined);
  const smallLimit = Math.max(3, Math.round(total * .00002));
  const smallComponentCount = components.filter(component => component.pixels.length <= smallLimit).length;
  let blackBorderPixels = 0;
  let borderPixels = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (x !== 0 && y !== 0 && x !== mask.width - 1 && y !== mask.height - 1) continue;
      borderPixels += 1;
      blackBorderPixels += mask.data[y * mask.width + x];
    }
  }
  const blackPercentage = total ? blackPixels / total * 100 : 0;
  const largestComponentPercentage = total && largest ? largest.pixels.length / total * 100 : 0;
  const borderCoveragePercentage = borderPixels ? blackBorderPixels / borderPixels * 100 : 0;
  const warnings: string[] = [];
  if (blackPercentage < .5) warnings.push('La máscara está prácticamente vacía.');
  if (blackPercentage > 80) warnings.push('Más del 80% de la imagen quedaría grabado.');
  if (largest?.touchesBorder && largestComponentPercentage > 60) warnings.push('Hay una masa negra grande conectada al borde.');
  if (smallComponentCount > Math.max(50, total / 1000)) warnings.push('Hay demasiados componentes minúsculos o ruido.');
  if (borderCoveragePercentage > 65) warnings.push('El contenido negro ocupa excesivamente los bordes.');
  return {
    blackPixels,
    blackPercentage,
    componentCount: components.length,
    smallComponentCount,
    largestComponentPercentage,
    borderCoveragePercentage,
    largestComponentTouchesBorder: largest?.touchesBorder ?? false,
    suspicious: warnings.length > 0,
    warnings,
  };
}

export const isSuspiciouslyFull = (mask: BinaryMask) => calculateMaskMetrics(mask).blackPercentage > 80;
