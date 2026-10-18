#!/usr/bin/env python3
"""Locate grey-substitute frames in this specific synthetic scene; not a pass/fail test.

The threshold is calibrated for its fixed palette/content, not arbitrary windows.
Capture requests 60 Hz but can drop frames. Missing a flash is not proof of absence.
Times and phase labels are callback-time observations, not display presentation fences.
"""
import csv
import pathlib
import sys

for directory in sys.argv[1:]:
    root = pathlib.Path(directory)
    with (root / 'frames.csv').open() as handle:
        rows = list(csv.DictReader(handle))
    print(root.name, len(rows), 'captured frames')
    if not rows:
        print('  NO EVIDENCE: empty capture')
        continue
    for region in ['left', 'middle', 'control']:
        values = [sum(float(row[f'{region}_{c}']) for c in 'rgb') / 3 for row in rows]
        flashes = [(row['frame'], row['phase']) for row, value in zip(rows, values) if value > 115]
        print(f'  {region}: mean-RGB range {min(values):.2f}..{max(values):.2f}; '
              f'grey frames (frame, phase): {flashes}')
print('Inspect the PNGs. No detected flash does not establish flicker-free rendering.')
