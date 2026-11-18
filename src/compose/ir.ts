/**
 * The new orchestration engine's internal musical representation.
 *
 * This is NOT `ConductorPlan`, NOT Piano V5's piano score, and NOT `Track[]`.
 * It is the provider-independent form in which the new engine thinks:
 * musical intention first, instrument-specific notes last.
 *
 * The plan is auditable: every part, every event traces back to a Director
 * assignment, and every motif transformation is recorded. If a note cannot be
 * traced to an assignment, it is a bug (`seal.ts` rejects it).
 */

export type Tick = number;

/* ------------------------------------------------------------------ roles */

/**
 * What a voice is doing musically. Independent of which instrument plays it.
 * This is the vocabulary the Composition layer speaks.
 */
export type MusicalRole =
  | 'lead'
  | 'counter'
  | 'inner'
  | 'bass'
  | 'pulse'
  | 'pad'
  | 'accent'
  | 'fill';

/**
 * The shared layer vocabulary a Director assignment maps onto for Piano V5's
 * `layerInformation` (the union V5 accepts). Kept as a local literal union so
 * this module never imports the old conductor.
 */
export type LayerName =
  | 'lead'
  | 'pad'
  | 'ostinato'
  | 'tremolo'
  | 'counterline'
  | 'bass'
  | 'fill'
  | 'stab'
  | 'percussion'
  | 'color'
  | 'sub'
  | 'riser'
  | 'texture';

export type SectionFunction =
  | 'opening'
  | 'continuation'
  | 'culmination'
  | 'contrast'
  | 'closing'
  | 'reprise';

export type PhraseFunction =
  | 'antecedent'
  | 'consequent'
  | 'transition'
  | 'climax'
  | 'cadence'
  | 'sustain';

/* ------------------------------------------------------------- the grid */

export interface MeterGrid {
  readonly timeSignature: { numerator: number; denominator: number };
  readonly barTicks: number;
  readonly beatTicks: number;
  readonly totalBars: number;
  readonly endTick: Tick;
}

export interface BarCell {
  readonly bar: number;
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly sectionFunction: SectionFunction;
  /** 0..1, the energy this bar is composed toward. */
  readonly energy: number;
}

/* --------------------------------------------------------- layer 1: context */

export interface FormSection {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  readonly occurrence: number;
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly startBar: number;
  readonly lengthBars: number;
  readonly function: SectionFunction;
}

export interface HarmonicSpan {
  readonly id: string;
  readonly symbol: string;
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly root: number;
  readonly bass: number;
  /** Chord tones as pitch classes. */
  readonly pitchClasses: number[];
  readonly intervals: number[];
}

/**
 * A register band an instrument may occupy for one assignment. `comfortable`
 * is the idiomatic window — the concept the old engine lacked as a hard
 * constraint, and the reason its parts sat at the top of their range.
 */
export interface RegisterBand {
  readonly low: number;
  readonly high: number;
  readonly comfortable: readonly [number, number];
  readonly centroid: number;
}

/* -------------------------------------------------- layer 2: material */

/** The unit of thematic identity. */
export interface Motif {
  readonly id: string;
  /** Scale degrees relative to the tonic, one per event. */
  readonly degrees: readonly number[];
  /** Durations in ticks, parallel to `degrees`. */
  readonly durations: readonly Tick[];
  /** Total span of the cell. */
  readonly lengthTicks: Tick;
  /** Where it first sounds. */
  readonly originBar: number;
}

export type DevelopmentOp =
  | 'identity'
  | 'transpose'
  | 'invert'
  | 'fragment'
  | 'augment'
  | 'displace'
  | 'reorchestrate';

/** One concrete statement of a motif, and how it was derived. */
export interface MotifStatement {
  readonly id: string;
  readonly motifId: string;
  readonly op: DevelopmentOp;
  /** Human-readable, for the report and for auditing development. */
  readonly note: string;
  readonly startTick: Tick;
  readonly endTick: Tick;
  /** Transposition in scale degrees (for 'transpose'). */
  readonly degreesShift: number;
}

export interface Phrase {
  readonly id: string;
  readonly sectionId: string;
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly startBar: number;
  readonly function: PhraseFunction;
  readonly statementIds: readonly string[];
  /**
   * The counterline's own statements: entered after the lead, built from the
   * contrasting motif. A counterline that shares the lead's statements and
   * durations is a doubling, not a counterpoint.
   */
  readonly counterStatementIds: readonly string[];
  /**
   * The antecedent this phrase answers, when it is the consequence of a
   * cross-section pair. Null for every other phrase.
   *
   * §13.2 criterion 3 asks for antecedent/consequent pairing across a section
   * boundary. Labelling phrases by index produced alternation but no answer:
   * the consequence drew its motif independently, and no pair ever crossed a
   * boundary. This link makes the relationship explicit and checkable.
   */
  readonly answersPhraseId: string | null;
  /** Phrase-boundary cues the Piano adapter surfaces as fill windows. */
  readonly cues: readonly PhraseCue[];
}

export type PhraseCueKind =
  | 'phrase-start'
  | 'phrase-end'
  | 'section-enter'
  | 'section-exit'
  | 'breath';

export interface PhraseCue {
  readonly kind: PhraseCueKind;
  readonly tick: Tick;
}

/* ------------------------------------------------ layer 3: the plan */

/** A Director decision: this instrument plays this role over these spans. */
export interface Participation {
  readonly role: string;
  readonly trackId: string;
  readonly materialRole: MusicalRole;
  readonly layer: LayerName;
  /** Sounding spans. A gap between spans is an intentional rest. */
  readonly spans: readonly { readonly startTick: Tick; readonly endTick: Tick }[];
  /** The Director's purpose for doubling this voice, or null. */
  readonly doublingOf: string | null;
  readonly doublingReason: string | null;
  /** Where this part sits, chosen by the Director from the register field. */
  readonly register: RegisterBand;
}

export type MomentKind = 'tutti' | 'soli' | 'unison';

/**
 * A planned orchestral moment. `participantRoles` is honest: Piano V5 decides
 * whether to yield or support by reading it, so it must name real roles.
 */
export interface PlannedMoment {
  readonly kind: MomentKind;
  readonly startBar: number;
  readonly endBar: number;
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly participantRoles: readonly string[];
  readonly shape?: 'hold' | 'breath' | 'decay';
}

export interface PlannedFill {
  /** Target spelling must be exactly 'piano' (or 'keys') to reach V5. */
  readonly target: string;
  readonly startTick: Tick;
  readonly endTick: Tick;
}

export interface SectionPlan {
  readonly sectionId: string;
  readonly participation: readonly Participation[];
  readonly density: number;
  /** Leading role this section, or null when no single voice leads. */
  readonly leadRole: string | null;
}

export interface OrchestraPlan {
  readonly sections: readonly SectionPlan[];
  readonly moments: readonly PlannedMoment[];
  readonly fills: readonly PlannedFill[];
}

/* ------------------------------------- layer 4/5: realization output */

export interface AbstractEvent {
  readonly start: Tick;
  readonly dur: Tick;
  /** Scale degree relative to tonic. Instrument- and octave-agnostic. */
  readonly degree: number;
  /** Chord tone flags for harmonic legality checking. */
  readonly chordTone: boolean;
}

/** Intention, not velocity. Mapped to velocity only at performance time. */
export interface DynamicIntent {
  readonly start: number; // 0..1
  readonly peak: number;  // 0..1
  readonly end: number;   // 0..1
}

export type ArticulationIntent =
  | 'sustained'
  | 'short'
  | 'accented'
  | 'plucked'
  | 'tremolo';

/** A family's realization of one participation. */
export interface RealizedNote {
  readonly pitch: number;
  readonly startTick: Tick;
  readonly durationTicks: Tick;
  readonly velocity: number;
  readonly articulation: Articulation;
  readonly role: MusicalRole;
  readonly phraseId: string;
  /** Motif statement this note belongs to, when it carries thematic material. */
  readonly statementId: string | null;
}

export type Articulation =
  | 'legato'
  | 'detache'
  | 'marcato'
  | 'staccato'
  | 'spiccato'
  | 'pizz'
  | 'tremolo'
  | 'portato'
  | 'sulTasto'
  | 'sulPont'
  | 'conSord'
  | 'sustain';

export interface MusicalPart {
  readonly trackId: string;
  readonly role: string;
  readonly register: RegisterBand;
  readonly notes: readonly RealizedNote[];
  /** Spans this part deliberately rests, stated rather than inferred. */
  readonly restSpans: readonly { readonly startTick: Tick; readonly endTick: Tick }[];
}

/* ------------------------------------------------------- the score */

export interface ScoreMeta {
  readonly seed: number;
  readonly take: number;
  readonly inputHash: string;
  readonly rosterHash: string;
  readonly engineVersion: string;
  readonly templateId: string | null;
}

export interface OrchestraScore {
  readonly meta: ScoreMeta;
  readonly grid: MeterGrid;
  readonly bars: readonly BarCell[];
  readonly sections: readonly FormSection[];
  readonly harmony: readonly HarmonicSpan[];
  readonly motifs: readonly Motif[];
  readonly statements: readonly MotifStatement[];
  readonly phrases: readonly Phrase[];
  readonly plan: OrchestraPlan;
  readonly parts: readonly MusicalPart[];
}

export const ENGINE_VERSION = 'compose-v1.0.0';
