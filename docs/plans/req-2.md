# REQ-2 plan: Test heart data

## Approach

Turn `virtual_cohort` into the real data every later requirement reads. Everything is deterministic and sequential: one process, one mesh at a time, so the Mac stays responsive.

**Who consumes this:** REQ-6 and REQ-9 read `data/hearts.dev.json`. REQ-13 reads `server-data/hearts.hidden.json`. REQ-4 and REQ-7 use `/api/hearts`, `meshUrl` and `thumbUrl`. REQ-18 reads `data/sources.json`. Keep these shapes stable.

**Source**
- `scripts/data/source.ts` takes the zip from `VALVULAR_DATA_ZIP`, defaulting to `/Users/mohammadallahham/Desktop/code/hackathon-agentverse/data/raw/verstraeten.zip`.
- Read with `unzip -p` and exact entry names only: `data_repository_Verstraeten_et_al_2023/virtual_cohort/shapeFeatures.xlsx` and `.../virtual_cohort/Case_N.stl`. Never use a wildcard, because `real_cohort` and `virtual_cohort_*` sit beside it with the same file names. Don't write the string `real_cohort` in `scripts/data/`.
- Publisher MD5, confirmed on the 4TU file API and against the local zip: `9f40559c1d58d42321c0d8fb680b68e5`.
- The table has 500 data rows, 8 numeric columns, no blanks. Parse with `exceljs`. `Case_N` is data row N (1-based), the order under test.

**IDs and measures**
- `Case_N` becomes `heart-NNN`, zero-padded to 3 digits.
- `measures` keep the source's full precision, and extend the fixture's key names:

| Source column | Key |
|---|---|
| `D_an` | `annulusMm` |
| `D_sinus` | `sinusMm` |
| `D_stj` | `sinotubularJunctionMm` |
| `D_lvot` | `lvotMm` |
| `H_sinus` | `sinusHeightMm` |
| `AVA` | `aorticValveArea` |
| `angle` | `angleDeg` |
| `ratio_lvot_over_an_area` | `lvotOverAnnulusAreaRatio` |

`AVA`'s unit isn't stated in the dataset's README, so the key carries none. RES-1 can settle it.

**Split:** `scripts/data/split.ts`, a pure function of the table. Seed `20230901` with a small seeded PRNG. Bands by annulus: under 21, 21-23, 23-25, 25-27, 27-29, 29 and over (lower edge inclusive). Sizes today are 33, 112, 136, 136, 57, 26. Shuffle within each band and allocate 20% by largest remainder, to get exactly 100 hidden and 400 dev, sorted by ID.

**Output files**
- `data/hearts.dev.json` and `server-data/hearts.hidden.json`, each `{ "hearts": Heart[] }`.
- Dev URLs: `/hearts/heart-NNN.glb` and `/hearts/heart-NNN.png`.
- Hidden hearts hold measures only, with `meshUrl` and `thumbUrl` set to `""`. **No hidden GLB or thumbnail is generated**: REQ-13 scores numbers only, so nothing needs them, and they can't leak or inflate the repo. `server-data/` holds only the JSON.
- `data/sources.json`: name, URL, DOI if given, authors, licence (CC BY 4.0), cohort `virtual_cohort`, MD5, seed, split method, column map, row-to-mesh method and thresholds.

**Meshes:** same pipeline as `scripts/fixtures/build-root-sample.ts`, so they drop in where the sample is used: `weld`, `simplify` (ratio 0.7, error 0.01, `lockBorder`), `quantize`, `meshopt`. The sample comes out at about 43 KB. Each STL has 16,981 triangles and an open rim at each end (193 boundary edges). Keep the holes: no filling, no volume calculation.

**Thumbnails (RES-4 fallback):** `scripts/data/thumbnail.ts`, a small software rasteriser using the same fixed view and one shared scale for all hearts, with z-buffer and simple Lambert shade in a neutral slate. No new dependency. 160x160 PNG via `node:zlib`, background exactly `#F7F8F8`. No status colours, because those are for fit status only. Python isn't needed, so don't add a venv.

**API**
- `src/app/api/hearts/route.ts`: `GET` returns `{ hearts }`, the 400 dev hearts.
- `src/app/api/hearts/[id]/route.ts`: `GET` returns `{ heart }` for a dev ID. Anything else gets the same 404 body, so a hidden ID looks like an unknown one.
- Both import only `data/hearts.dev.json`. Nothing in `src/` reads `server-data/` in this requirement.

**Row-to-mesh threshold, fixed here before any run**

In `scripts/data/row-mesh.ts`, as `ROW_MESH_MAX_RESIDUAL_MM = 4` and `ROW_MESH_MIN_R = 0.9`. **Commit this file before its first run.** The spec locks these values. If the check fails, stop and report it. Don't tune them, change the descriptor or commit assets.

- Mesh descriptor: `s`, the square root of the total triangle area from the raw STL. It needs no closed surface and barely changes with the root's angle.
- Table descriptor: `d`, the mean of `D_lvot`, `D_an`, `D_sinus`, `D_stj` (SD 2.75 mm; each correlates 0.87 to 0.96 with the mean, so one size factor dominates).
- Fit `d = a*s + b` by least squares across the numeric mapping. Pass needs `r >= 0.9` **and** all 500 residuals `<= 4 mm`.
- Controls, applying the same `a`, `b`: lexicographic order (`Case_1`, `Case_10`, `Case_100`...) and off-by-one (row N to `Case_N+1`, cyclic). Each must give `r <= 0.5` and at least 50 rows over 4 mm. A control that passes means the check can't tell mappings apart, so fail.

While choosing this, only the table's own statistics and the raw geometry of `Case_1` and `Case_2` were looked at. `s` hasn't been computed or compared with the table on any heart.

**`scripts/data/check.ts`**, replacing the stub. Runs in this order and exits non-zero at the first failure, so bad inputs fail fast:
1. Zip present and MD5 matches. A missing zip is a failure, never a skip.
2. Rebuild the table and split, twice. Compare both with the committed JSON: same IDs, split and exact measures.
3. No overlap, 400 + 100, band match, and annulus exclusions of 116 (21-27) and 59 (21-29), bounds inclusive. All verified on the table already.
4. Row-to-mesh across all 500 STLs, one at a time.

The last line is exactly `data:check report: ` plus this JSON:

```json
{
  "source": { "md5": "", "expectedMd5": "", "match": true },
  "split": { "seed": 20230901, "identicalOnRerun": true, "dev": 400, "hidden": 100, "overlap": 0,
             "bands": [{ "minMm": null, "maxMm": 21, "dev": 0, "hidden": 0 }] },
  "annulus": { "excluded21to27": 116, "excluded21to29": 59 },
  "rowMesh": { "checked": 500, "failed": 0, "maxResidualMm": 0, "thresholdMm": 4, "r": 0, "minR": 0.9,
               "controls": [{ "mapping": "lexicographic", "r": 0, "overThreshold": 0 },
                            { "mapping": "off-by-one", "r": 0, "overThreshold": 0 }] }
}
```

`minMm` is `null` for the lowest band and `maxMm` is `null` for the highest.

**Build:** `npx tsx scripts/data/build.ts`, so `package.json` doesn't change. Sequential; expect a few minutes.

## Size budget

Each GLB under 300 KB, each PNG at most 15 KB, and `public/hearts/` at most 30 MB in total. Expect about 18 MB of GLBs and 3 MB of PNGs. Commit the assets once, when final, so git history doesn't collect stale blobs. Report the total in your result.

## Spec notes

- No GPU or Gemini step, so nothing is tagged `@gpu` or `@live`.
- The spec reads the table from the zip itself, and recomputes bands and exclusions from the JSON, so it doesn't rely only on the report.
- It tampers with `data/hearts.dev.json` and `server-data/hearts.hidden.json`, restoring them in `finally`. A failed run can leave a dirty tree only if the process is killed. Check `git status` then.
- It runs `data:check` for real. Expect about a minute, on top of the run in `verify`.
- Port: `PORT=3002`, one worker.

## Files

- `scripts/data/check.ts`, `source.ts`, `split.ts`, `row-mesh.ts`, `thumbnail.ts`, `build.ts`
- `data/hearts.dev.json`, `data/sources.json`, `server-data/hearts.hidden.json`
- `public/hearts/heart-NNN.glb`, `public/hearts/heart-NNN.png` (400 of each)
- `src/app/api/hearts/route.ts`, `src/app/api/hearts/[id]/route.ts`
- `tests/e2e/req-2.spec.ts`

## Risks

- **The row-to-mesh gate may fail honestly.** The descriptor is a global size, chosen without tuning. A failure doesn't prove the mapping is wrong, but the rule is to stop and flag it, not adjust it.
- **The gate's limit:** it proves the ordering as a whole and catches outliers. It can't detect a swap of two same-sized hearts. Say so in the result.
- **Hosting:** when REQ-13 first reads `server-data/` at runtime, it must make sure the file is included in the hosted build's trace. Not needed here.
- **The default zip path is machine-specific**, as requested. Other machines set `VALVULAR_DATA_ZIP`, and `verify` fails there without it. REQ-20's README should mention this.
- **Asset count:** 800 extra static files. All are small and loaded on demand, so nothing here touches the 3D rendering budget.
