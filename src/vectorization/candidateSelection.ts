import { areMasksVisuallySimilar, compareMasks } from './maskSimilarity';
import type { ClientResultLabel, MaskCandidate, SelectedMaskCandidate } from './types';

export type CandidateGroup = {
  representative: MaskCandidate;
  members: MaskCandidate[];
};

const warningCount = (candidate: MaskCandidate) => candidate.metrics.warnings.length + candidate.score.penalties.length;

function compareCandidateQuality(left: MaskCandidate, right: MaskCandidate) {
  if (left.score.value !== right.score.value) return right.score.value - left.score.value;
  const warningDifference = warningCount(left) - warningCount(right);
  if (warningDifference) return warningDifference;
  if (left.metrics.borderCoveragePercentage !== right.metrics.borderCoveragePercentage) {
    return left.metrics.borderCoveragePercentage - right.metrics.borderCoveragePercentage;
  }
  return left.metrics.smallComponentCount - right.metrics.smallComponentCount;
}

export function isViableCandidate(candidate: MaskCandidate) {
  const { metrics, score } = candidate;
  if (score.value < 30) return false;
  if (metrics.blackPercentage < .5 || metrics.blackPercentage > 88) return false;
  if (metrics.borderCoveragePercentage > 88) return false;
  if (metrics.largestComponentTouchesBorder && metrics.largestComponentPercentage > 72) return false;
  // A high tiny-component count alone does not disqualify structural line-art:
  // only reject when most of the ink itself is speckle noise.
  if (metrics.smallComponentCount > 500 && metrics.tinyComponentInkPercentage > 25) return false;
  return true;
}

export function groupSimilarCandidates(candidates: MaskCandidate[]): CandidateGroup[] {
  const sorted = [...candidates].sort(compareCandidateQuality);
  const groups: CandidateGroup[] = [];
  for (const candidate of sorted) {
    const group = groups.find(current => areMasksVisuallySimilar(current.representative.mask, candidate.mask));
    if (group) group.members.push(candidate);
    else groups.push({ representative: candidate, members: [candidate] });
  }
  return groups;
}

function diversityFrom(candidate: MaskCandidate, selected: MaskCandidate[]) {
  return Math.min(...selected.map(current => {
    const similarity = compareMasks(candidate.mask, current.mask);
    const visualDistance = 1 - similarity.intersectionOverUnion;
    const coverageDistance = Math.abs(candidate.metrics.blackPercentage - current.metrics.blackPercentage) / 100;
    const componentDistance = Math.min(1, Math.abs(Math.log2(candidate.metrics.componentCount + 1) - Math.log2(current.metrics.componentCount + 1)) / 7);
    return visualDistance * .7 + coverageDistance * .18 + componentDistance * .12;
  }));
}

function labelsForSelection(selected: MaskCandidate[]): ClientResultLabel[] {
  // Alternatives are ordered by visual diversity, not by a detail scale.
  if (selected.length === 1) return ['Recomendada'];
  if (selected.length === 2) return ['Recomendada', 'Alternativa'];
  return ['Recomendada', 'Alternativa 1', 'Alternativa 2'];
}

export function selectBestCandidates(candidates: MaskCandidate[], maximum = 3): SelectedMaskCandidate[] {
  const viable = candidates.filter(isViableCandidate);
  if (!viable.length || maximum < 1) return [];
  const representatives = groupSimilarCandidates(viable).map(group => group.representative).sort(compareCandidateQuality);
  const selected = [representatives[0]];
  const qualityFloor = Math.max(30, representatives[0].score.value - 40);
  const pool = representatives.slice(1).filter(candidate => candidate.score.value >= qualityFloor);

  while (selected.length < Math.min(3, maximum) && pool.length) {
    const ranked = pool.map(candidate => ({ candidate, diversity: diversityFrom(candidate, selected) }))
      .sort((left, right) => right.diversity - left.diversity || compareCandidateQuality(left.candidate, right.candidate));
    const next = ranked[0];
    if (next.diversity < .08) break;
    selected.push(next.candidate);
    pool.splice(pool.indexOf(next.candidate), 1);
  }

  const labels = labelsForSelection(selected);
  return selected.map((candidate, index) => ({
    candidate,
    label: labels[index],
    score: candidate.score.value,
    selectedReason: index === 0
      ? 'Mejor equilibrio entre calidad, cobertura y diagnóstico.'
      : `Aporta una interpretación diferente a las opciones anteriores (${Math.round(diversityFrom(candidate, selected.slice(0, index)) * 100)}% de diversidad).`,
  }));
}
