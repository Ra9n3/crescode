/**
 * Chord Generator settings panel (spec §6, §7, §8) — dedicated modal following
 * the app's existing dialog pattern. Changes save automatically (no Apply
 * button), live in the project file, and participate in undo/redo. Every
 * control here is preparation for the future harmony engine: values are stored
 * and round-trip through save/load/export, and a single unobtrusive notice says
 * so instead of tagging each of them.
 */
import { DEFAULT_CHORDGEN_SETTINGS } from '../shared/schema/types';
import { useStore } from '../store/store';
import { randomSeed } from '../lib/chordGenUi';
import { I } from './icons';
import { Button, Ico, IconButton, MiniSlider, Modal, NumberField, Select, ToggleSwitch } from './ui';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-[var(--c-lineSoft)] py-3">
      <div className="w-44 shrink-0"><div className="text-xs font-semibold">{label}</div>{hint && <div className="mt-0.5 text-[10px] leading-snug text-[var(--c-textMute)]">{hint}</div>}</div>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="printed pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em]" data-testid={`chordgen-group-${title.toLowerCase()}`}>{title}</div>
      {children}
    </div>
  );
}

export function ChordGenSettingsDialog() {
  const s = useStore();
  const close = () => s.set({ modal: null });
  const gs = s.project.chordGenSettings ?? DEFAULT_CHORDGEN_SETTINGS;
  const set = (patch: Parameters<typeof s.setChordGenSettings>[0], coalesce?: string) => s.setChordGenSettings(patch, coalesce);
  return (
    <Modal title="Chord Generator" icon={I.magic} onClose={close} width={620} testId="chordgen-panel"
      footer={<>
        <Button className="mr-auto" tip="Restore every control to its default" testId="chordgen-reset" onClick={() => set(DEFAULT_CHORDGEN_SETTINGS)}>Reset to defaults</Button>
        <Button primary onClick={close}>Done</Button>
      </>}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--c-textMute)]" data-testid="chordgen-not-connected">
        <Ico icon={I.info} className="shrink-0 text-[13px] text-[var(--c-info)]" />
        Saved with the project and ready for the chord generator — they take effect once the harmony engine is connected.
      </p>

      <Group title="General">
        <Row label="Harmonic complexity" hint="Triads → sevenths → extensions">
          <Select<number> tip="Harmonic complexity" value={gs.complexity} testId="chordgen-complexity"
            options={[{ value: 1, label: 'Triads' }, { value: 2, label: 'Triads + sevenths' }, { value: 3, label: 'Sevenths + extensions' }]}
            onChange={(v) => set({ complexity: v as 1 | 2 | 3 })} />
        </Row>
        <Row label="Chord density" hint="Harmonic rhythm — how often chords change">
          <Select<number> tip="Harmonic rhythm / chord density" value={gs.density} testId="chordgen-density"
            options={[{ value: 0, label: 'Sparse' }, { value: 1, label: 'Moderate' }, { value: 2, label: 'Dense' }]}
            onChange={(v) => set({ density: v as 0 | 1 | 2 })} />
        </Row>
        <Row label="Variation amount" hint="Restraint → adventurous across generations">
          <MiniSlider value={gs.variation} min={0} max={1} def={0.5} width={120} tip="Variation amount" format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ variation: Math.round(v * 100) / 100 }, 'chordgen-variation')} />
        </Row>
      </Group>

      <Group title="Harmony">
        <Row label="Chromatic borrowing" hint="How freely chords come from outside the mode">
          <Select<'none' | 'some' | 'more'> tip="Chromatic borrowing preference" value={gs.borrowing} testId="chordgen-borrowing"
            options={[{ value: 'none', label: 'None' }, { value: 'some', label: 'Some' }, { value: 'more', label: 'More' }]}
            onChange={(v) => set({ borrowing: v })} />
        </Row>
        <Row label="Cadence strength" hint="How firmly phrases resolve">
          <Select<'soft' | 'balanced' | 'strong'> tip="Cadence strength" value={gs.cadence} testId="chordgen-cadence"
            options={[{ value: 'soft', label: 'Soft' }, { value: 'balanced', label: 'Balanced' }, { value: 'strong', label: 'Strong' }]}
            onChange={(v) => set({ cadence: v })} />
        </Row>
        <Row label="Modal character" hint="Straight → strongly modal colour">
          <MiniSlider value={gs.modalEmphasis} min={0} max={1} def={0.5} width={120} tip="Modal character emphasis" format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set({ modalEmphasis: Math.round(v * 100) / 100 }, 'chordgen-modal')} />
        </Row>
      </Group>

      <Group title="Structure">
        <Row label="Repeated sections" hint="A second chorus keeps the first one's harmonic identity">
          <ToggleSwitch on={gs.preserveIdentity} tip="Preserve harmonic identity across repeated sections" testId="chordgen-preserve"
            onChange={(on) => set({ preserveIdentity: on })} />
          <span className="text-xs text-[var(--c-textDim)]">Preserve identity</span>
        </Row>
        <Row label="Section-aware harmony" hint="Harmony follows each section's type and position">
          <ToggleSwitch on={gs.sectionAware} tip="Section-aware harmony behavior" testId="chordgen-sectionaware"
            onChange={(on) => set({ sectionAware: on })} />
          <span className="text-xs text-[var(--c-textDim)]">Enabled</span>
        </Row>
      </Group>

      <Group title="Advanced">
        <Row label="Seed" hint="Deterministic variation source — advances by one on every successful Generate">
          <NumberField value={gs.seed} min={0} max={4294967295} step={1} width={90} tip="Generator seed (0–4294967295)"
            onCommit={(v) => set({ seed: Math.round(v) })} />
          <IconButton icon={I.dice} tip="Roll a new random seed" testId="chordgen-seed-dice" onClick={() => set({ seed: randomSeed() })} />
        </Row>
      </Group>
    </Modal>
  );
}
