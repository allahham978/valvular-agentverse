# RES-3: Heart model for the opening scene

Sources read 7 November 2026. Scratch tools stayed outside the download folder, and nothing from a download was run.

## Decision

**Build REQ-3 on NIH 3D 3DPX-022787, but don't publish it until the licence question below is settled.** Its look and fit are the best of anything I could download and test. It isn't a clean pass on "clear licence".

- **The problem:** NIH 3D lists it as CC0, but the file's internal names (`tripo_node_…`, `tripo_mat_…`, `tripo_image_…`) show it was made with the Tripo AI generator. The NIH page doesn't say this. Tripo's terms (§5.2.1, updated 11 July 2025) say Tripo keeps all rights to free users' outputs, while §5.2.2 gives paid users their rights. We don't know which plan the uploader used. If it was the free plan, the CC0 may not be valid.
- **To clear it:** get written confirmation from the creator, Sourav Pan, that a paid plan was used and that no third-party image was the input. Local builds and local commits are fine until then, but don't push the file, host it or make the repo public with it.
- **If it can't be cleared:** swap to Sketchfab "Human heart" by Freddan755 (CC BY 4.0). Someone has to log in to download it, so I haven't inspected its mesh, and its valve location would need measuring.
- **If that also fails:** use the aortic-root fallback. It isn't needed today.

## Chosen model

| Item | Detail |
|---|---|
| Title | Human Heart 3d Model, 3DPX-022787 |
| Source | https://3d.nih.gov/entries/3DPX-022787 |
| Download used | `https://3d.nih.gov/api/download?submissionId=37664&fileIds=1458485` (the site's public download, no login) |
| Licence at source | Page metadata says `"license":"Public Domain"`, and the badge links to CC0 1.0. See the Decision for the doubt over this |
| Credit line | "Human Heart 3d Model" (3DPX-022787) by Sourav Pan, via NIH 3D, listed as CC0 1.0. Geometry simplified and materials replaced. Illustrative only. |
| Origin | AI-generated with Tripo, based on the internal names. The page credits Biology Notes Online, whose linked article mentions no 3D model and states no open licence |
| Real patient data | No sign of any: it wasn't scanned or segmented. I can't rule out what the generator's input or training data contained |
| Local file | `data/raw/heart-model/heart-nih3d.glb`, gitignored |
| SHA-256 | `31adacc10a662372ea676033bae8fe689d4f3646de328c7e7d6e62db810ecdb4` |
| Format and size | GLB (glTF 2.0, Blender exporter), 16.7 MB (16,737,944 bytes), with 3 embedded JPEG textures. No animation or rig |
| Geometry | 149,992 triangles, 449,794 raw vertices, 74,974 after welding. One connected mesh, 12 open edges, no non-manifold edges. No named parts |
| Bounds | x ±0.2511, y ±0.5000, z ±0.3253, centred on the origin, with no node transform |
| Inside | Closed outer shell only: no chambers or valves. That suits the brief, because the heart fades before the camera arrives |

## Where the aortic valve sits

**Centre: `(0.08, 0.00, 0.03)` in model units, ±0.03 on each axis. Valve axis, pointing up the aorta: `(0.024, 0.932, 0.361)`, about ±15° by judgement.** This is an estimate, because the model has no valve to measure. It's good enough for a zoom target that fades into the root, but not for any measurement.

- **Axes:** +X is anterior, +Y is superior, +Z is the patient's right. The front of the heart faces +X.
- **Scale:** 1 model unit is about 225 mm (range 200-250). The ventricles are about 0.57 wide, against 124-143 mm for the reference hearts, and the ascending aorta is 0.123 across, about 28 mm. A 24 mm annulus would be about 0.11 units across.

How I got there:

1. Slicing the mesh gives a straight, near-vertical ascending aorta, centred at `(0.083, y, 0.067)` for y from 0.20 to 0.16.
2. The aorta joins the heart body at about y = 0.10.
3. From that join, I went about 0.11 units (about 25 mm, a typical root height from memory, not read from a source) along the valve axis. The axis is halfway between the aorta and the left ventricle's long axis, which runs from the apex at `(0.047, -0.395, -0.291)`.

Checks:

- **Inside the shell:** rays from the point cross the surface an odd number of times in all six directions, and the nearest surface vertex is 0.058 units away.
- **Distance to apex:** 0.51 units, which is 102-128 mm across the scale range. The reference hearts with labelled valves measure 97.6 mm (Rodero average), 101.4 mm (HRA female) and 104.9 mm (HRA male), so the point may sit slightly too far from the apex.
- **Visual:** see `res-3/chosen-valve-target.png`.

If the model is rescaled or recentred, these coordinates need the same transform. My test conversion left the bounds unchanged.

## Conversion needed

Tested with gltf-transform and meshoptimizer: remove textures and UVs, weld, simplify to 50%, apply 12 passes of Taubin smoothing, compute smooth normals, then compress with meshopt.

| Output | Triangles | Vertices | Size |
|---|---|---|---|
| Full detail, not smoothed | 149,992 | 74,974 | 903 KB |
| **50%, smoothed (recommended)** | 74,996 | 37,476 | **470 KB** |

- **File budget:** the recommended output is well under the brief's 5 MB limit, so there's room to keep more detail.
- **Normals:** gltf-transform's `normals()` gave flat-shaded facets and 449,976 vertices in my test. Compute area-weighted smooth normals on the welded mesh instead.
- **Aorta tint:** the mesh has no separate aorta, so a vertex-colour mask is needed. A mask built from distance to the aorta's centre line worked in a test render, using this line: `(0.083,0.09,0.067)`, `(0.083,0.22,0.067)`, `(0.07,0.30,0.05)`, `(0,0.335,0.03)`, `(-0.07,0.29,0)`, `(-0.1,0.2,-0.012)`, `(-0.106,0.1,-0.013)`, radius about 0.075, plus the three arch branches. My test colour `#D79A9C` is barely visible, so it needs a stronger value.

## Honest visual assessment

Rendered with a satin clearcoat material on `#F7F8F8`, with the model's own textures removed. The original textures are unusable: patchy pink and blue with obvious seams.

**Good**
- From a distance it reads straight away as a clean medical education model, and it takes the satin material well.
- The aorta is clearly visible from the front.
- The main external parts are present and in sensible positions: arch with three branches, superior and inferior vena cava, pulmonary trunk and branches, pulmonary veins, right atrium, and an apex pointing to the patient's left.

**Weak**
- It's plausible rather than verified accurate, and no clinician has reviewed it. The "Illustrative" label matters here.
- The descending aorta merges into the back of the heart at about y = 0.08 instead of running on, and it's as wide as the ascending aorta.
- The coronary vessels are ropey and can't be traced as real anatomy. The groove between the ventricles is faint.
- Close up there are jagged seams where the aorta and pulmonary trunk meet the heart. Smoothing softens these but doesn't remove them.
- The back and sides are weaker than the front. Keep the slow turn to about ±35° around the front rather than a full rotation.

**Not tested:** frame rate on a real GPU (these renders used software WebGL at 800 px), the brief's HDRI lighting, the full 1440x900 frame and a projector.

## Other candidates

| Candidate | Licence read at source | Origin | Aorta | Verdict |
|---|---|---|---|---|
| [NIH 3DPX-000906](https://3d.nih.gov/entries/3DPX-000906) | CC BY 4.0 | **A real person's CT**: "The skeleton from the original CT was removed" | Full, down to the legs | Rejected. Clear licence, but real-person data and the wrong look: lumpy surface, dense vessel branches, kidneys attached, 640,130 triangles, 53 MB |
| [HRA 3D heart, female and male](https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html) | CC BY 4.0 | **Real people**: Visible Human donors, shaped by a medical illustrator | **None** | Rejected for the opening. Very smooth, with labelled valves, but no aorta. Useful as a reference for valve position |
| [Rodero average heart](https://zenodo.org/records/4593739) | CC BY 4.0 | Statistical shape model built from **real CTs** | Short stub | Rejected. Blobby, with visible seams and no recognisable heart shape from outside |
| [Sketchfab, Freddan755](https://sketchfab.com/3d-models/3342c8c438904ee2b3b6b68fedf30531) | CC BY 4.0 (API) | Student work, tagged Mudbox and 3ds Max, no sign of a scan | Prominent | **First backup.** Clear licence and good shape, 54,452 triangles. Seen from one angle only, and login needed to download |
| [Sketchfab, Mesh-Magnet](https://sketchfab.com/3d-models/5da08bb137014f0392c69f9997f777cd) | CC BY 4.0 (API) | Not stated, could also be AI-generated | Visible | Second backup. Clean thumbnail, 20,395 triangles. Not inspected |
| [Sketchfab, neshallads](https://sketchfab.com/3d-models/3f8072336ce94d18b3d0d055a1ece089) | CC BY 4.0 (API) | Tagged ZBrush | Visible | Rejected on thumbnail: wet and gory. Mesh not inspected |
| [Sketchfab, tinkerlane_studio](https://sketchfab.com/3d-models/adb2c91ec8194b24b7ba431aa573a906) | CC BY 4.0 (API) | Not stated | Visible | Rejected on thumbnail: cartoonish. Mesh not inspected |
| [Sketchfab, sahilseth](https://sketchfab.com/3d-models/30f93d9dae4948fe85cd4d60ac40c23f) | CC BY 4.0 (API) | Tagged SculptGL | Visible | Rejected on thumbnail: clean clay, but odd vessels. Mesh not inspected |

**Out on licence, from search results and not read at source:** BodyParts3D and Z-Anatomy (CC BY-SA), and the Dundee sculpted heart on AnatomyTOOL (CC BY-NC-SA).

**Not checked:** OpenGameArt's CC0 heart (page blocked me), a public-domain Printables heart (I only reached a mirror, which blocked me, and didn't try Printables itself), and the Smithsonian's collection search (blocked me). A web search found no Smithsonian 3D heart.

## Limits of this research

- Sketchfab downloads need a login (the API returned 401), so its models were judged on metadata, thumbnails and, for Freddan755 and Mesh-Magnet, the public viewer. Those aren't equal to the meshes I measured.
- NIH 3D's terms say contributors choose their licence and NIH doesn't enforce it, and that NIH doesn't guarantee accuracy. Don't imply NIH endorsement.

Renders are in `res-3/`.
