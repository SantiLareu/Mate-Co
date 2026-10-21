import type { CircularLines } from '../App';
import type { ApprovedDesignSnapshot } from '../approved-designs/approvedDesign';
import type { ApprovedDesignInstance } from '../approved-designs/approvedDesign';
import type { DesignIcon } from '../components/IconElement';
import type { TextElement } from '../components/CurvedText';

export type ProductionLabFixture = {
  texts: TextElement[];
  icons: DesignIcon[];
  approved: ApprovedDesignInstance[];
  circularLines: CircularLines;
};

/**
 * Source-model fixture for the lab: the SAME editor models MatePreview
 * renders (TextElement / DesignIcon / ApprovedDesignInstance), with icon art
 * referenced by catalog id only (no duplicated icon paths) and no embedded
 * artwork bytes. Approved art is never bundled here: the factory accepts an
 * optional caller-supplied VALIDATED snapshot (e.g. loaded through the
 * existing sanitizer by the UI unit) and keeps it by identity. Everything is
 * frozen so lab runs cannot mutate the shared original.
 */
export function createProductionLabFixture(
  approvedSnapshot?: ApprovedDesignSnapshot,
): ProductionLabFixture {
  const texts: TextElement[] = [
    {
      id: 'lab-text-top', text: 'Mate&Co', fontFamily: 'Georgia',
      angle: 0, radius: 374, inverted: false,
    },
    {
      id: 'lab-text-bottom', text: 'Edición física', fontFamily: 'Georgia',
      angle: 180, radius: 340, inverted: true, scale: 0.9,
    },
  ];
  const icons: DesignIcon[] = [
    {
      id: 'lab-icon-spark', type: 'icon', iconId: 'spark',
      angle: 90, radius: 360, scale: 1, rotation: 15, mirrored: false, inverted: false,
    },
    {
      id: 'lab-icon-heart', type: 'icon', iconId: 'heart',
      angle: 270, radius: 360, scale: 1, rotation: -10, mirrored: true, inverted: false,
    },
  ];
  const approved: ApprovedDesignInstance[] = approvedSnapshot ? [{
    id: 'lab-approved-1',
    type: 'approved-design',
    approvedDesignId: approvedSnapshot.id,
    snapshot: approvedSnapshot,
    angle: 180,
    radius: 360,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  }] : [];
  return Object.freeze({
    texts: Object.freeze(texts.map(text => Object.freeze({ ...text }))),
    icons: Object.freeze(icons.map(icon => Object.freeze({ ...icon }))),
    approved: Object.freeze(approved.map(item => Object.freeze({ ...item }))),
    circularLines: 'double' as CircularLines,
  }) as ProductionLabFixture;
}

/** Backwards-compatible alias for the pure-foundation spec suite. */
export const createLabFixture = createProductionLabFixture;
