import type { BinaryMask } from './types';

export type MaskSimilarity = {
  intersectionOverUnion: number;
  dice: number;
  differentPixelPercentage: number;
};

export function compareMasks(left: BinaryMask, right: BinaryMask): MaskSimilarity {
  if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) {
    return { intersectionOverUnion: 0, dice: 0, differentPixelPercentage: 100 };
  }
  let intersection = 0;
  let union = 0;
  let leftBlack = 0;
  let rightBlack = 0;
  let different = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    const leftValue = left.data[index] === 1;
    const rightValue = right.data[index] === 1;
    if (leftValue) leftBlack += 1;
    if (rightValue) rightBlack += 1;
    if (leftValue && rightValue) intersection += 1;
    if (leftValue || rightValue) union += 1;
    if (leftValue !== rightValue) different += 1;
  }
  const bothEmpty = union === 0;
  return {
    intersectionOverUnion: bothEmpty ? 1 : intersection / union,
    dice: leftBlack + rightBlack === 0 ? 1 : 2 * intersection / (leftBlack + rightBlack),
    differentPixelPercentage: left.data.length ? different / left.data.length * 100 : 0,
  };
}

export function areMasksVisuallySimilar(left: BinaryMask, right: BinaryMask) {
  const similarity = compareMasks(left, right);
  return similarity.intersectionOverUnion >= .9
    || (similarity.dice >= .94 && similarity.differentPixelPercentage <= 2.5);
}
