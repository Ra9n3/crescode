# Delivery notes

Final archive: `package/Strings_V1_Ensemble_Orchestration_Identity_V1_Studio_One_Audition.zip`.

Drive: https://drive.google.com/file/d/156F-i7Aj0tKPIk5np_MlvPEcTiu_n_Gd/view

796,043 bytes; 347 archive entries; 295 MIDI files. SHA256:
`a90f295dadc67a81443c043a7b86d645e4ba6570d6844252098f6b9f588d1f02`.

## Clarification of “full” MIDI

`01_full__uvi.mid` means the existing application's **merged UVI export**, not a promise that all project stems fit that file. The unchanged UVI profile omits file-only Timpani/Snare/Cymbals from merged files and leaves Aux unmapped. No new percussion-export policy was introduced. Nonstring project tracks/CC remain equal to classic. Use `02_strings__uvi.mid` or the individual string files for the requested string audition.

## Validation scope

The independent Python parser verifies note transport/content (including keyswitch notes) and derives musical statistics. It does not separately hash every new exported controller event. Controller lanes are protected by production-object comparisons, classic golden CC/export fingerprints, and direct archived V2 byte comparisons. The normal installed-library export/CC test suite remains blocked by missing dependencies.

The authored audit encoder is an explicit dependency-free verification substitute for missing `midi-file`, not a package installation. Its relevant encoding matches nine archived complete string MIDI files byte-for-byte. This and independent parsing do not constitute a normal Vitest/typecheck/build pass or sample-library audition.

The ZIP is immutable after upload; its checksums and all payload checks were reverified. This note lives beside it to make the unchanged merged-export omissions and validation boundary particularly explicit.

No listening approval, Studio One execution, new UI enablement, sharing change, commit or push.
