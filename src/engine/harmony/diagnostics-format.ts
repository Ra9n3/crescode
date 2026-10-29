/**
 * Human-readable diagnostic formatting (Phase 4.2, spec §13B) — a compact
 * report suitable for musical review. Every value printed here comes from
 * the report's recorded data; categories the implementation does not have
 * are printed as "Not implemented" rather than approximated.
 */
import { barTicks } from '../../shared/schema/meter';
import { roundTo } from './planning';
import type { HarmonyDiagnosticReport, StructuralSlotRecord } from './diagnostics';

const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : String(roundTo(v, 3));
const pc = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : roundTo(v, 2).toFixed(2);
const signed = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  const r = roundTo(v, 2);
  return r > 0 ? `+${r}` : String(r);
};

function contourLabel(c: { family: string; level?: number; lo?: number; hi?: number; peak?: number; cycles?: number }): string {
  switch (c.family) {
    case 'stable': return `stable(${pc(c.level)})`;
    case 'arch': return `arch(${pc(c.lo)}→${pc(c.hi)} @${pc(c.peak)})`;
    case 'valley': return `valley(${pc(c.lo)}→${pc(c.hi)} @${pc(c.peak)})`;
    case 'wave': return `wave(${pc(c.lo)}→${pc(c.hi)} ×${c.cycles})`;
    default: return `${c.family}(${pc(c.lo)}→${pc(c.hi)})`;
  }
}

function transitionPartsLine(parts: object | null): string {
  if (!parts) return '';
  const entries = Object.entries(parts as Record<string, number>).filter(([, v]) => v !== 0);
  if (entries.length === 0) return 'base only';
  return entries.map(([k, v]) => `${k} ${signed(v)}`).join(', ');
}

/** The one-line alternatives table for a structural slot. */
function alternativesLine(slot: StructuralSlotRecord): string {
  if (slot.alternatives.length === 0) return '';
  return slot.alternatives
    .map((a) => {
      const marks = [
        a.selected ? 'SEL' : null,
        a.rejectedBy ?? null,
      ].filter(Boolean).join(',');
      const suffix = marks ? ` [${marks}]` : '';
      return `${a.rank + 1}) ${a.label} ${num(a.total)}${suffix}`;
    })
    .join(' · ');
}

/**
 * Render the full diagnostic report as compact, human-readable text.
 */
export function formatHarmonyDiagnostics(report: HarmonyDiagnosticReport): string {
  const ctx = report.context;
  const bt = barTicks(ctx.timeSignature);
  const barOf = (tick: number): number => Math.floor(tick / bt) + 1;
  const L: string[] = [];

  L.push('CRESCODE HARMONY DIAGNOSTIC');
  L.push(`Model: ${report.meta.generationModel}`);
  L.push(`Selection: ${report.meta.selectionModel}`);
  L.push(`Key: ${ctx.keyName}  Mode: ${ctx.mode}  Meter: ${ctx.timeSignature.numerator}/${ctx.timeSignature.denominator}  Seed: ${ctx.seed}  Scope: ${ctx.scope.type}`);
  const s = ctx.settings;
  L.push(`Settings: complexity ${s.complexity} · density ${s.density} · variation ${pc(s.variation)} · borrowing ${s.borrowing} · cadence ${s.cadence} · modal ${pc(s.modalEmphasis)} · preserveIdentity ${s.preserveIdentity ? 'yes' : 'no'} · sectionAware ${s.sectionAware ? 'yes' : 'no'}`);
  L.push(`Region: bars ${barOf(ctx.region.startTick)}–${barOf(Math.max(ctx.region.startTick, ctx.region.endTick - 1))} (ticks ${ctx.region.startTick}–${ctx.region.endTick}) · fingerprint ${ctx.projectFingerprint}`);
  const pool = report.planning.pool;
  L.push(`Pool: ${pool.size} foundations (${pool.diatonicCount} diatonic, ${pool.size - pool.diatonicCount} chromatic) · symmetric ${pool.symmetric ? 'yes' : 'no'} · tonic ${pool.tonicName} ${pool.tonicQuality} · beam ${pool.searchParams.beamWidth}×${pool.searchParams.successorsPerBeam} · signature cap ${pool.searchParams.maxPerSignature} · strong cutoff ${pool.searchParams.strongCutoff}`);
  if (ctx.anchors.before !== null || ctx.anchors.after !== null) {
    L.push(`Anchors: before ${ctx.anchors.before ?? '—'} · after ${ctx.anchors.after ?? '—'} · protected spans in region ${ctx.anchors.protectedSpans}`);
  }
  L.push('');

  // ---- Planned sections & phrases -----------------------------------------
  L.push('PLANNED SECTIONS');
  for (const sec of report.planning.sections) {
    const p = sec.preferences;
    L.push(`▸ ${sec.sectionName} (bars ${sec.startBar}–${sec.startBar + sec.lengthBars - 1}) identity "${sec.identity}" (confidence ${pc(sec.identityConfidence)}) energy ${pc(sec.energy)}${sec.energyExplicit ? '' : ' (default)'} · development ${sec.development.role}${sec.development.relatedSectionIds.length ? ` ← [${sec.development.relatedSectionIds.join(', ')}]` : ''}`);
    L.push(`  prefs stability ${pc(p.stability.preferred)} · movement ${pc(p.movement.preferred)} · complexity ${pc(p.complexity.preferred)} · tension ${pc(p.tension.preferred)} · modal ${pc(p.modalEmphasis.preferred)} · contrast ${pc(p.contrast.preferred)} · rhythm ${p.rhythm.preferredChangesPerBar}/bar (${p.rhythm.shape})`);
    L.push(`  contours tension ${contourLabel(sec.contours.tension)} · rhythm ${contourLabel(sec.contours.rhythm)} · complexity ${contourLabel(sec.contours.complexity)}`);
    if (sec.boundary) L.push(`  boundary → ${sec.boundary.toSectionId}: ${sec.boundary.intention}`);
  }
  if (report.planning.sections.length === 0) L.push('(no sections — synthetic neutral plan)');
  L.push('');

  // ---- Rhythm --------------------------------------------------------------
  L.push(`RHYTHM (${report.rhythm.slots.length} slots)`);
  L.push(`  Note: ${report.rhythm.continuationModelNote}`);
  for (const slot of report.rhythm.slots) {
    const flags = [
      slot.mergedIntoPreviousEvent ? 'merged' : null,
      slot.continuationRealizedStructurally ? 'foundation continued' : 'new foundation',
    ].filter(Boolean).join(' · ');
    L.push(`  #${String(slot.slotIndex).padStart(2, '0')} bar ${barOf(slot.startTick)} t${slot.startTick}+${slot.durationTicks} ${slot.phraseId ?? '(synthetic)'} pos ${slot.positionInPhrase}/${slot.phraseSlotCount}${slot.phraseEnd ? ' ARRIVAL' : ''} pref ${slot.preference.changesPerBar}/bar ${slot.preference.shape} · ${flags}`);
  }
  L.push('');

  // ---- Progression chart (the musical view, spec §13B) ---------------------
  L.push('PROGRESSION');
  {
    const sectionNames = new Map(ctx.sections.map((x) => [x.id, x.name]));
    let lastPhraseId: string | null = null;
    for (const ev of report.color) {
      const slot = report.structure.slots.find((sl) => sl.startTick === ev.startTick);
      const phraseId = slot?.phraseId ?? null;
      if (phraseId !== lastPhraseId) {
        const phrase = report.planning.phrases.find((p) => p.id === phraseId);
        const sectionId = phrase?.sectionId ?? slot?.sectionId ?? null;
        const header = phrase
          ? `${sectionNames.get(sectionId ?? '') ?? sectionId ?? '(song)'} — phrase ${phrase.id} (bars ${phrase.startBar}–${phrase.startBar + phrase.lengthBars - 1}, ${phrase.role}, cadence ${phrase.cadence.intention})`
          : `${sectionNames.get(slot?.sectionId ?? '') ?? slot?.sectionId ?? '(unplanned span)'} — synthetic window (ticks ${ev.startTick})`;
        L.push(`  ${header}`);
        lastPhraseId = phraseId;
      }
      const op = ev.operation;
      const ops: string[] = [];
      if (op.thirdReplaced) ops.push(`third REPLACED by suspension (${op.nonDiatonicPcs.length ? 'chromatic: ' + op.nonDiatonicPcs.join('/') : 'diatonic'})`);
      else if (op.thirdOmitted) ops.push('third OMITTED');
      else if (op.thirdPreserved) ops.push('third preserved');
      if (op.suspensionIntroduced && !op.thirdReplaced) ops.push('suspension introduced');
      if (op.extensionAdded) ops.push('extension added');
      if (op.chromaticNotesIntroduced && !op.thirdReplaced) ops.push(`chromatic tones: ${op.nonDiatonicPcs.join('/')}`);
      if (ev.slotCount > 1) ops.push(`sustains ${ev.slotCount} slots`);
      if (ev.basicFallback) ops.push('basic fallback (no pooled colors)');
      const slotRec = report.structure.slots.find((sl) => sl.startTick === ev.startTick);
      const movement = slotRec?.relationshipToPrevious
        ? ` · root movement ${signed(slotRec.relationshipToPrevious.rootMovementSemitones)} from ${slotRec.previousFoundation}`
        : '';
      const role = slotRec ? ` · role ${slotRec.structuralRole}` : '';
      L.push(`    bar ${barOf(ev.startTick)}: ${ev.symbol}  foundation ${ev.foundationLabel}${movement}${role}`);
      L.push(`      color: ${ops.length ? ops.join(' · ') : 'identity'}`);
    }
  }
  L.push('');

  // ---- Decision detail ------------------------------------------------------
  L.push('STRUCTURAL DECISIONS');
  if (report.structure.windows.length === 0) L.push('  (no windows generated)');
  for (const win of report.structure.windows) {
    const phrase = report.planning.phrases.find((p) => p.id === win.phraseId);
    L.push(`─ ${win.phraseId ?? `(synthetic ${win.startTick})`} ${phrase ? `(${phrase.role}, cadence ${win.cadenceIntention})` : `(role ${win.role}, cadence ${win.cadenceIntention})`} ticks ${win.startTick}–${win.endTick} · section ${win.sectionId ?? '—'} · slots ${win.slotCount} · arrival ${win.arrivalPlanned ? 'planned' : 'clipped'}`);
    const sel = win.selection;
    if (sel === null) {
      L.push('    search trace: Not collected');
    } else if (sel.mode === 'reuse') {
      L.push(`    search: REUSE (${sel.reuseReason}) — whole-phrase trajectory evaluation: Not applied on this path`);
      if (sel.material) {
        L.push(`    source material: [${sel.material.sourceLabels.join(' › ')}]`);
        L.push(`    mapped: [${sel.material.mappedLabels.join(' › ')}]`);
        for (const ms of sel.material.slots) {
          const extras = [
            ms.substitution ? `substituted (candidates: ${ms.substitutionCandidates.join(', ')})` : null,
            ms.cadentialVariation ? `cadential variation (${ms.cadentialCandidates.map((c) => `${c.label} ${num(c.score)}`).join(', ')})` : null,
          ].filter(Boolean).join(' · ');
          L.push(`      slot ${ms.slotIndex}: ${ms.mapped} → ${ms.chosen}${extras ? ' · ' + extras : ''}`);
        }
      }
    } else if (sel.beam) {
      L.push('    search: beam');
      L.push('    finals (complete paths, ranked):');
      for (const f of sel.beam.finals) {
        const marks = [f.strong ? 'strong' : null, f.chosen ? 'CHOSEN' : null].filter(Boolean).join(', ');
        const bonus = f.anchorBonus !== null ? ` + anchor ${num(f.anchorBonus)}` : '';
        L.push(`      ${f.rank + 1}. [${f.path.join(' › ')}] total ${num(f.total)} = cum ${num(f.cumulative)} + path ${num(f.pathEvaluation.total)}${bonus} · ${marks}`);
      }
      L.push(`    strong cutoff ${num(sel.beam.strongCutoff)} · seeded pick index ${sel.beam.chosenIndex}`);
      for (let si = 0; si < sel.beam.slots.length; si++) {
        const st = sel.beam.slots[si];
        L.push(`    slot ${si}: beams ${st.beamsBefore}→${st.beamsAfter} · expansions ${st.expansionsEvaluated} · successors ${st.successorsKept} · sig-caps ${st.signatureCapsHit} · width-pruned ${st.widthPruned}`);
      }
    }
    if (sel?.pathEvaluation) {
      const c = sel.pathEvaluation.components;
      L.push(`    path evaluation: ${num(sel.pathEvaluation.total)} (movement-diversity ${num(c.movementDiversity)}, tonal-identity ${num(c.tonalIdentity)}, prolongation ${num(c.prolongationPurposefulness)}, development ${num(c.development)})`);
    } else if (sel && sel.mode === 'beam') {
      L.push('    path evaluation: Not available');
    }
    if (sel?.forcedFirst) L.push(`    forced first (sustain across boundary): ${sel.forcedFirst}`);
    if (sel?.developOpeningOverride) L.push(`    develop opening override: ${sel.developOpeningOverride}`);
    if (win.relatedPhraseIds.length > 0) L.push(`    related phrases: [${win.relatedPhraseIds.join(', ')}]`);
  }
  L.push('');

  // ---- Per-slot scoring -----------------------------------------------------
  L.push('SLOT SCORING (selected candidate vs its actual contest)');
  for (const slotRec of report.structure.slots) {
    const rel = slotRec.relationshipToPrevious;
    const flags: string[] = [];
    if (slotRec.repeatsPreviousFoundation) flags.push('repeats previous foundation');
    if (slotRec.chromaticDeparture) flags.push('chromatic departure');
    if (slotRec.mergedWithNext) flags.push('merged with next slot');
    L.push(`  bar ${barOf(slotRec.startTick)} slot ${slotRec.slotIndex} t${slotRec.startTick}+${slotRec.durationTicks} → ${slotRec.selected.label} · ${slotRec.structuralRole}${flags.length ? ' · ' + flags.join(' · ') : ''}`);
    if (rel) {
      L.push(`    vs ${slotRec.previousFoundation}: root ${signed(rel.rootMovementSemitones)} st · shared core ${rel.sharedCoreTones} (${pc(rel.coreCommonRatio)}) · same quality ${rel.sameQuality ? 'yes' : 'no'} · leading into cand ${rel.leadingToneIntoCandidate ? 'yes' : 'no'}${rel.sameRootDifferentCore ? ' · pedal reclassification' : ''}`);
    }
    const sc = slotRec.selectedCandidateScores;
    if (sc) {
      L.push(`    score: total ${num(sc.total)} = parent ${num(sc.parentScore)} + transition ${num(sc.transition)} + position ${num(sc.position)}${sc.loopPenalty ? ` − loop ${num(sc.loopPenalty)}` : ''} + jitter ${num(sc.jitter)} (rank ${sc.rankInExpansion})`);
      if (sc.transitionParts) L.push(`      transition parts: ${transitionPartsLine(sc.transitionParts)}`);
    }
    // Phase 4.3A: the corrected stability model, from the recorded values.
    // The four factors are objective evidence; the "score contribution" is
    // the ACTUAL scored sum of the transition parts the stability term
    // produces (structural consonance + modal quality norm), or — when no
    // searched score exists (reuse path) — not stated at all.
    {
      const ev = slotRec.stabilityEvidence;
      const contribution = sc?.transitionParts
        ? sc.transitionParts.structuralConsonance + sc.transitionParts.qualityStability
        : null;
      L.push(`    stability evidence: structural ${pc(ev.structuralConsonance)} · tonic-root ${pc(ev.tonicRootRelationship)} · tonic-chord ${pc(ev.tonicChordRelationship)} · modal ${pc(ev.modalCompatibility)} · score contribution ${signed(contribution)}`);
    }
    const alts = alternativesLine(slotRec);
    if (alts) L.push(`    contest: ${alts}`);
  }
  L.push('');

  // ---- Color decisions --------------------------------------------------------
  L.push('COLOR DECISIONS (Stage B)');
  for (const ev of report.color) {
    const variants = ev.availableColors
      .map((v, i) => `${v.symbol} w${num(v.rawWeight)}→${num(v.variedWeight)}${i === ev.pickedIndex ? ' PICKED' : ''}`)
      .join(' · ');
    L.push(`  ev${ev.eventIndex} bar ${barOf(ev.startTick)} ${ev.symbol} ← ${ev.foundationLabel} · complexity pref ${pc(ev.complexityPref)} · modal ${pc(ev.modalPref)}${ev.isArrival ? ` · ARRIVAL (${ev.intention})` : ''}`);
    if (variants) L.push(`    variants: ${variants}`);
    else L.push('    variants: none (basic fallback)');
  }
  L.push('');

  // ---- Transitions ---------------------------------------------------------
  L.push('TRANSITIONS (classified on foundation identity)');
  for (const t of report.transitions) {
    const kind = t.classification === 'structural-movement'
      ? `structural-movement root ${signed(t.rootMovementSemitones)}`
      : t.classification;
    L.push(`  #${t.index} ${t.fromSymbol} → ${t.toSymbol} · ${kind}${t.separatedByPreserved ? ' · separated by preserved chord' : ''}`);
  }
  if (report.transitions.length === 0) L.push('  (no adjacent generated pairs)');

  // ---- Cadences --------------------------------------------------------------
  if (report.structure.cadences.length > 0) {
    L.push('');
    L.push('STRUCTURAL CADENCE REALIZATIONS');
    for (const c of report.structure.cadences) {
      L.push(`  bar ${barOf(c.startTick)} ${c.phraseId ?? '(synthetic)'}: intention ${c.intention} → realized family ${c.family ?? 'none identified'} (${c.previousFoundation ?? '—'} → ${c.arrivalFoundation})`);
    }
  }

  // ---- Merges ------------------------------------------------------------------
  if (report.structure.merges.length > 0) {
    L.push('');
    L.push('SUSTAINED EVENTS (merged same-foundation slot runs)');
    for (const m of report.structure.merges) {
      L.push(`  ev${m.eventIndex} bar ${barOf(m.startTick)} ${m.foundation} · ${m.slotCount} slots · ${m.durationTicks} ticks${m.crossWindow ? ' · crosses phrase boundary' : ''}`);
    }
  }

  // ---- Warnings ------------------------------------------------------------
  L.push('');
  L.push(`WARNINGS: ${report.warnings.length === 0 ? 'none' : ''}`);
  for (const w of report.warnings) L.push(`  ! ${w}`);
  return L.join('\n');
}
