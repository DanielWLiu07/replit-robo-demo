# FlyWire data

`flywire-soma.bin` / `flywire-soma.json` are derived from the FlyWire FAFB v783
neuron annotations — 139,248 neurons with their soma (or annotated) coordinates,
`super_class`, and cell type.

Source: https://github.com/flyconnectome/flywire_annotations
(`supplemental_files/Supplemental_file1_neuron_annotations.tsv`)

Derivation: coordinates converted from 4x4x40 nm voxels to isotropic space,
centred, normalised by the longest axis and quantised to uint16 per axis; one
byte per neuron carries `super_class` and which of the six simulated circuits
the cell belongs to. No connectivity or morphology is included.

Cite, as the annotation authors require:

- Schlegel et al. (2024) — whole-brain annotation of the adult *Drosophila* brain
- Dorkenwald et al. (2024) — FlyWire connectome
- Matsliah et al. (2024) — Codex
- Berg et al. (2025)

The FlyWire data is shared for research/non-commercial use; check the upstream
terms before any commercial reuse.
