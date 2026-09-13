import type { BinaryMask } from './types';

export type ConnectedComponent = { pixels: number[]; touchesBorder: boolean };

export function connectedComponents(mask: BinaryMask, value: 0 | 1 = 1): ConnectedComponent[] {
  const { width, height, data } = mask;
  const visited = new Uint8Array(data.length);
  const components: ConnectedComponent[] = [];
  const queue = new Int32Array(data.length);
  for (let start = 0; start < data.length; start += 1) {
    if (visited[start] || data[start] !== value) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pixels: number[] = [];
    let touchesBorder = false;
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let direction = 0; direction < neighbors.length; direction += 1) {
        const next = neighbors[direction];
        if (next < 0 || next >= data.length || visited[next] || data[next] !== value) continue;
        if ((direction === 0 && x === 0) || (direction === 1 && x === width - 1)) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    components.push({ pixels, touchesBorder });
  }
  return components;
}

export function removeSmallComponents(mask: BinaryMask, minimumPixels: number): BinaryMask {
  const data = new Uint8Array(mask.data);
  for (const component of connectedComponents(mask, 1)) {
    if (component.pixels.length < minimumPixels) {
      for (const index of component.pixels) data[index] = 0;
    }
  }
  return { ...mask, data };
}

export function fillSmallHoles(mask: BinaryMask, maximumPixels: number): BinaryMask {
  const data = new Uint8Array(mask.data);
  for (const component of connectedComponents(mask, 0)) {
    if (!component.touchesBorder && component.pixels.length <= maximumPixels) {
      for (const index of component.pixels) data[index] = 1;
    }
  }
  return { ...mask, data };
}

export function cleanMask(mask: BinaryMask, minimumComponentPixels = 2, maximumHolePixels = 2) {
  return fillSmallHoles(removeSmallComponents(mask, minimumComponentPixels), maximumHolePixels);
}

export function dilateMask(mask: BinaryMask, radius = 1): BinaryMask {
  const data = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let black = false;
      for (let dy = -radius; dy <= radius && !black; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= mask.width || nextY >= mask.height) continue;
          if (mask.data[nextY * mask.width + nextX]) {
            black = true;
            break;
          }
        }
      }
      data[y * mask.width + x] = Number(black);
    }
  }
  return { ...mask, data };
}

export function erodeMask(mask: BinaryMask, radius = 1): BinaryMask {
  const data = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let black = true;
      for (let dy = -radius; dy <= radius && black; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= mask.width || nextY >= mask.height || !mask.data[nextY * mask.width + nextX]) {
            black = false;
            break;
          }
        }
      }
      data[y * mask.width + x] = Number(black);
    }
  }
  return { ...mask, data };
}

export function closeMask(mask: BinaryMask, radius = 1) {
  return erodeMask(dilateMask(mask, radius), radius);
}
