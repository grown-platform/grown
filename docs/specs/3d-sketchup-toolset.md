# 3D App — SketchUp Toolset Research & Replication Roadmap

Feature research (sourced from the official SketchUp Help Center, help.sketchup.com)
cataloguing SketchUp's full in-app toolset, categorized, with three.js replication
difficulty and a mapping to what our 3D app already has. The goal: a concrete,
prioritized backlog for growing our viewer/modeler into a SketchUp-style web CAD tool.

## Where we are today

Our 3D app (`web/app/src/pages/3d/`) already ships:

- **Viewer**: three.js scene, OrbitControls (orbit/pan/zoom), Fit-to-view (≈ Zoom
  Extents), grid/ground, glb/gltf/obj/stl/ply loaders, Drive open + inline preview.
- **Editor (SketchUp-style toolset)**: Select / Move / Rotate / Scale (transform
  gizmos with snap), Box / Plane / Cylinder / Sphere primitives, Push/Pull on box
  faces, Paint (matte / metal / glass solid colors), Erase, Tape Measure (measure),
  Undo/Redo, Save .glb → Drive `/models`.
- **Model Library** with thumbnails + a seeded "Example Ship" default model.

So we have the *transform* half of SketchUp and a primitive palette. What we lack is
the **2D-sketch-into-3D drawing workflow**, the **inference/snapping engine** that
makes that workflow usable, **organization** (groups/components/tags), **boolean
solid tools**, **render styles / shadows / scenes**, and **section cuts**.

## Prioritized roadmap (impact vs. effort)

**Quick wins (Easy, high polish-per-hour):**
- Rectangle / Circle / Polygon face drawing on the ground/active plane (we already
  do plane/cylinder/sphere math).
- Fog (`scene.fog`), From-Scratch terrain grid (subdivided plane).
- Tags (per-object visibility channels) + Outliner (scene-graph tree).
- Render-mode Styles via material swaps: Wireframe, X-Ray, Monochrome, Hidden Line.
- Textures + sample (eyedropper) on the existing Paint Bucket.
- Field-of-view control, Parallel-projection (ortho camera) toggle, Previous/Next
  view history, 2D/3D Text labels (`TextGeometry` / CSS2D).

**Medium lifts (real features, bounded scope):**
- **Groups & Components** — the foundational reuse model (definition/instances over
  a shared `BufferGeometry`); enter/exit edit context + Outliner.
- **Section Plane** — native via `material.clippingPlanes` + a plane gizmo. High value.
- **Solid Tools** (Union / Subtract / Intersect / Trim / Split / Outer Shell) via
  `three-bvh-csg`.
- Move/Rotate/Scale upgrades: Ctrl-copy, linear/radial arrays, numeric entry,
  protractor/handle UX (extends gizmos we already have).
- Shadows (DirectionalLight + soft shadow map, sun position from date/time),
  Scenes (saved camera + state snapshots, tween between).
- Dimensions (dynamic, geometry-associated), Protractor + construction guides.

**Big bets (Hard, but the real differentiators):**
- **Inference / snapping engine** (point + linear + locking inferences). The single
  highest-value, highest-effort piece — it's what makes a web CAD tool feel like
  SketchUp instead of a toy. Prerequisite for the drawing tools feeling good.
- **Follow Me** (path sweep + lathe) and **Offset** (2D polygon offset / straight
  skeleton) — no three.js built-ins.
- First-person camera mode (Position Camera / Look Around / Walk) with optional
  collision; Section Fills (stencil-buffer capping); Sandbox terrain sculpting
  (Smoove / Stamp / Drape); Add Location (geo terrain, out of scope for now).

---

<!-- The three sections below are the full sourced catalog. -->

## Drawing & Modification Tools

> Sources: official SketchUp Help Center (help.sketchup.com). Shortcuts are SketchUp's default desktop/web bindings.
> **App-status legend:** 🆕 = genuinely new for our app · ⚠️ = partially have · ✅ = already have.

### DRAWING TOOLS — 2D geometry, all genuinely new for us (we have no on-face/ground-plane sketching)

#### Line 🆕
- **Shortcut:** `L`
- **What it does:** Draws straight edges between clicked points; chained edges that close a coplanar loop auto-create a face. The structural foundation of all SketchUp geometry.
- **Modifiers/inferences:** Arrow keys lock to axes (↑ Blue/Z, ← Green/Y, → Red/X); `Shift` locks the current inference direction; type exact length in the Measurements box or absolute `[x,y,z]` / relative `<x,y,z>` coords; snaps to endpoint, midpoint, intersection, on-edge, on-face.
- **Doc:** https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts
- **three.js difficulty:** **Medium** — raycast a click ray onto the active face/ground plane, accumulate points into a polyline, triangulate the closed loop into a face. Inference snapping is the real work.

#### Freehand 🆕
- **Shortcut:** none by default
- **What it does:** Click-drag to sketch a continuous freeform curve; result is a single curve entity that can still bound/divide a face. Draws on a face or in free space.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-freehand-shapes
- **three.js difficulty:** **Medium** — sample pointer positions onto the plane, decimate into a polyline; same triangulation path as Line.

#### Rectangle 🆕
- **Shortcut:** `R`
- **What it does:** Click two opposite corners to draw a rectangular face on the inferred plane.
- **Modifiers/inferences:** Type `length,width` in Measurements; negatives reverse direction; blue diagonal dots flag a perfect square / golden-section, `Shift` locks it.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-basic-shapes
- **three.js difficulty:** **Easy** — two raycast points on a plane define a quad. We already do plane primitives.

#### Rotated Rectangle 🆕
- **Shortcut:** none by default (Shapes flyout)
- **What it does:** Three-click rectangle at an arbitrary angle/plane: first edge sets baseline + plane, then width dragged off a protractor.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-basic-shapes
- **three.js difficulty:** **Medium** — protractor-on-arbitrary-plane interaction + local 2D basis from the first edge, mapped back to world space.

#### Circle 🆕
- **Shortcut:** `C`
- **What it does:** Click center, drag radius to draw a circular face from N straight segments (default 24).
- **Modifiers/inferences:** Type radius in Measurements; type `<n>s` to set segment count before/after.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-basic-shapes
- **three.js difficulty:** **Easy** — `CircleGeometry`/segmented fan on the picked plane.

#### Polygon 🆕
- **Shortcut:** none by default (Shapes flyout)
- **What it does:** Click center, drag radius to draw a regular N-sided polygon face (3+ sides). Edges stay creased when extruded (unlike a circle).
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-basic-shapes
- **three.js difficulty:** **Easy** — identical to Circle with a chosen low N.

#### Arc / Pie 🆕
- **Shortcut:** `A` (Arc)
- **What it does:** Center-based arc (center, start, end). **Arc** = open segmented curve; **Pie** = closes into a wedge face.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-arcs
- **three.js difficulty:** **Medium** — sample arc into a polyline on the plane; Pie triangulates the wedge.

#### 2-Point Arc 🆕
- **Shortcut:** `A` (default Arc tool in modern SketchUp)
- **What it does:** Click start, click end (chord), pull perpendicular to set the bulge. Tangent (magenta) and half-circle (cyan) inferences; two tangent arcs make a smooth join.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-arcs
- **three.js difficulty:** **Medium** — chord + bulge → circle solve, sample to polyline.

#### 3-Point Arc 🆕
- **Shortcut:** none by default (Arcs flyout)
- **What it does:** Three points (start, pivot, end) define the arc; `Alt`/`Cmd` locks a tangent arc off a hovered edge.
- **Doc:** https://help.sketchup.com/en/sketchup/drawing-arcs
- **three.js difficulty:** **Medium** — circumcircle through 3 points, sample to polyline.

### MODIFICATION TOOLS

#### Move ⚠️ (have gizmo + snap; missing Ctrl-copy, arrays, axis-key locking)
- **Shortcut:** `M`
- **What it does:** Translates selection (or hovered geometry) from a grabbed point to a target.
- **Modifiers:** `Ctrl`/`Option` = copy; after a copy type `*n`/`xn` for a linear array or `/n` to subdivide; arrow keys lock axes; exact distance in Measurements.
- **Doc:** https://help.sketchup.com/en/sketchup/moving-entities-around-model
- **three.js difficulty:** **Easy** — gizmo exists; Ctrl-copy + array multipliers are incremental.

#### Rotate ⚠️ (have gizmo + snap; missing protractor placement, rotate-copy, angle entry)
- **Shortcut:** `Q`
- **What it does:** Rotates around a placed protractor center/axis.
- **Modifiers:** `Ctrl`/`Option` = rotated copy (+`*n` radial arrays); exact degrees in Measurements; protractor color = locked plane.
- **Doc:** https://help.sketchup.com/en/sketchup/flipping-mirroring-rotating-and-scaling-entities
- **three.js difficulty:** **Easy/Medium** — on-plane protractor placement + Ctrl radial-array copy.

#### Scale ⚠️ (have gizmo + snap; missing handle box, factor/dimension entry, center/uniform modifiers)
- **Shortcut:** `S`
- **What it does:** Resizes via a 27-handle bounding box; drag a handle to scale along that axis/face/corner.
- **Modifiers:** Type a scale factor or absolute dimension; `Ctrl`/`Option` = scale about center; `Shift` toggles uniform; corner = uniform, edge = non-uniform.
- **Doc:** https://help.sketchup.com/en/sketchup/flipping-mirroring-rotating-and-scaling-entities
- **three.js difficulty:** **Easy/Medium** — bounding-box handle UI + center/uniform modifiers + dimension entry.

#### Push/Pull ⚠️ (have it on box faces; missing arbitrary-face, Ctrl new-face, double-click repeat, cut-through)
- **Shortcut:** `P`
- **What it does:** Extrudes a face perpendicular to add volume, or pushes inward to subtract / cut a hole.
- **Modifiers:** `Ctrl`/`Option` starts a new face (stacks geometry); double-click repeats last distance; exact distance in Measurements; parallel-face inference warns on full cut-through.
- **Doc:** https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d
- **three.js difficulty:** **Medium/Hard** — works on box faces today; arbitrary drawn faces need general face extrusion + boolean cut-through (CSG) for holes.

#### Follow Me 🆕 (we do NOT have)
- **Shortcut:** none by default
- **What it does:** Sweeps/extrudes a profile face along a path (edge chain) — moldings, pipes; a circular path lathes a profile into a revolved solid (vases, spindles).
- **Doc:** https://help.sketchup.com/en/sketchup/extruding-follow-me
- **three.js difficulty:** **Hard** — true sweep/loft along an arbitrary path (frame orientation along the curve) plus a lathe mode; miter/intersection handling at corners is non-trivial.

#### Offset 🆕 (we do NOT have)
- **Shortcut:** `F`
- **What it does:** Creates parallel copies of a face's edges (or 2+ connected coplanar edges) at a uniform distance — inward or outward.
- **Doc:** https://help.sketchup.com/en/sketchup/offsetting-line-existing-geometry
- **three.js difficulty:** **Medium/Hard** — 2D polygon-offset (straight-skeleton / miter) with self-intersection cleanup; no three.js built-in.


## Measurement, Camera & Section Tools

"Have / New" reflects our current app (OrbitControls orbit/pan/zoom, Fit-to-view, Tape Measure, grid/ground).

### CONSTRUCTION / MEASUREMENT

#### Tape Measure ✅ (have measure mode; guide creation is new)
- **Shortcut:** `T`
- **What it does:** Measures distances and creates construction geometry — guide lines and guide points.
- **Modifiers:** `Ctrl`/`Option` cycles Measure / Create Guide Line / Create Guide Point; typing a value after measuring an entity offers to resize the whole model (global scale).
- **Doc:** https://help.sketchup.com/en/measuring-distance
- **three.js difficulty:** Easy (measure — we have it); guide-line/point creation is **Medium** (new persistent construction-geometry layer that snaps but isn't real geometry).

#### Dimensions 🆕
- **What it does:** Linear/radial/diameter dimension entities (leader + text) that update dynamically as geometry changes.
- **Doc:** https://help.sketchup.com/en/sketchup/adding-text-labels-and-dimensions-model
- **three.js difficulty:** **Medium** — rendering line+ticks+billboard text is easy; the dynamic auto-update (re-measuring as vertices move) needs entity-association bookkeeping.

#### Protractor 🆕
- **What it does:** Measures angles and sets precise angled guide lines rotated about a vertex/axis.
- **Modifiers:** Type exact angle (degrees) or slope as rise:run; ticks at 15°; `Shift` locks the plane; `Alt`/`Cmd` frees the protractor from the inferred plane.
- **Doc:** https://help.sketchup.com/en/measuring-angles
- **three.js difficulty:** **Medium** — angle math trivial; the protractor gizmo (plane pick, ticks, typed input) + angled-guide output is the work.

#### Axes tool 🆕
- **What it does:** Relocates/reorients the drawing axes so you can draw accurately on sloped/rotated surfaces.
- **Doc:** https://help.sketchup.com/en/sketchup/adding-text-labels-and-dimensions-model
- **three.js difficulty:** **Medium** — a re-orientable working-plane/grid transform feeding the snap system; a custom local coordinate frame.

#### Text (Leader / Screen Text) 🆕
- **What it does:** Annotation text — Screen Text (fixed to screen) or Leader Text (a leader line to an entity, optionally showing its data).
- **Doc:** https://help.sketchup.com/en/sketchup/adding-text-labels-and-dimensions-model
- **three.js difficulty:** **Easy** — HTML overlay (CSS2DRenderer) or sprite; leader line is a simple `Line`.

#### 3D Text 🆕
- **What it does:** Real edges/faces geometry generated from typed text (house numbers, engravings).
- **Doc:** https://help.sketchup.com/en/sketchup-ipad/3d-text
- **three.js difficulty:** **Easy/Medium** — `TextGeometry` + `FontLoader` + extrude; fonts must be preloaded as typeface JSON.

#### Add Location / Geo 🆕 (out of scope)
- **What it does:** Imports geolocated satellite imagery + terrain for site context.
- **three.js difficulty:** **Hard** — needs a map-tile/terrain provider integration.

### CAMERA / NAVIGATION

#### Orbit ✅ — `O` — HAVE (OrbitControls). Free-orbit (Ctrl, disable gravity) would need TrackballControls-style rotation.
#### Pan ✅ — `H` — HAVE (OrbitControls pan).
#### Zoom ✅ — `Z` — HAVE. Shift+drag changes FOV (one-line `camera.fov` + `updateProjectionMatrix()`).
#### Zoom Window 🆕 — `Ctrl+Shift+W` — **Medium**: reproject the screen-rectangle corners to a target frustum and animate.
#### Zoom Extents ✅ — `Shift+Z` — HAVE (our Fit-to-view; bbox → fit distance).
#### Position Camera 🆕 — eye height above a clicked point (default 5'6"). **Medium** — raycast to ground/face, offset up, set look target; pairs with a first-person mode.
#### Look Around 🆕 — pivots camera in place. **Medium** — first-person yaw/pitch (PointerLockControls-style); conflicts with OrbitControls' target-orbit model.
#### Walk 🆕 — moves through the model at fixed eye height with collision. **Hard** — first-person controller + raycast collision.
#### Previous / Next View 🆕 — view undo/redo. **Easy** — push camera state onto a history stack and tween.
#### Field of View / Parallel vs Perspective 🆕 — FOV = `PerspectiveCamera.fov`; **Parallel projection** = swap to `OrthographicCamera` (**Medium**: match framing + re-wire OrbitControls); two-point perspective is **Hard** (oblique projection matrix).
- **Camera docs:** https://help.sketchup.com/en/sketchup/viewing-model · https://help.sketchup.com/en/sketchup/walking-through-model

### SECTION

#### Section Plane 🆕 (high value)
- **What it does:** A cutting plane that slices the model non-destructively to see inside.
- **Modifiers:** Click a face to place; `Shift` locks orientation; arrow keys snap the normal to axes; right-click for Reverse / Align View; only one active plane cuts per context.
- **Doc:** https://help.sketchup.com/en/sketchup/slicing-model-peer-inside
- **three.js difficulty:** **Medium** — native via `renderer.clippingPlanes` / `material.clippingPlanes` (a `THREE.Plane`) + `localClippingEnabled`, plus an interactive plane gizmo.

#### Section Fills 🆕
- **What it does:** Caps the closed loops exposed at the cut so the slice reads solid.
- **three.js difficulty:** **Hard** — clipping leaves the cut hollow; capping needs the stencil-buffer cap technique.

#### Display Section Cuts / Planes (toggles) 🆕 — **Easy** — two booleans: show/hide the gizmo mesh; enable/disable `clippingPlanes`.
- **Docs:** https://help.sketchup.com/en/tags/display-section-planes-tool · https://help.sketchup.com/en/tags/display-section-cuts-tool

## Organization, Materials, Solid & Sandbox Tools + Inference

> We have Paint (solid colors only), primitives, transform gizmos, Erase. Everything below is NEW for us except where Paint Bucket overlaps.

### ORGANIZATION

#### Groups 🆕 — `Edit > Make Group` (often **G**)
- Gathers entities into one selectable object that moves/copies/hides as a unit and doesn't "stick" to surrounding geometry. Double-click to enter/edit; nestable, lockable.
- Doc: https://help.sketchup.com/en/sketchup/grouping-geometry
- **Difficulty: Medium** — a `THREE.Group` parent node; the work is the editing-context UX + selection model.

#### Components (+ Component Browser / instances) 🆕 — `Edit > Make Component`
- A reusable object with one definition and many instances; editing the definition updates all instances. The Components panel browses/inserts/replaces.
- Doc: https://help.sketchup.com/en/sketchup/components
- **Difficulty: Medium–Hard** — definition/instance maps to one shared `BufferGeometry` referenced by many meshes; live-edit propagation + browser UI is real work. **The core reuse primitive.**

#### Make Component / Explode 🆕
- Promote a selection into a definition; Explode breaks a group/component back into raw geometry.
- Doc: https://help.sketchup.com/en/sketchup/grouping-geometry
- **Difficulty: Easy–Medium** — re-parenting nodes + baking transforms.

#### Tags (formerly Layers) 🆕 — `Window > Tags`
- Named visibility channels assigned to whole groups/components; the eye icon toggles all objects with a tag. Does not isolate geometry (unlike groups).
- Doc: https://help.sketchup.com/en/sketchup/controlling-visibility-tags
- **Difficulty: Easy** — a string tag per object + a visibility filter + side panel.

#### Outliner 🆕 — `Window > Outliner`
- Hierarchical tree of groups/components/section-planes for navigating, renaming, re-nesting, toggling visibility.
- Doc: https://help.sketchup.com/en/sketchup/working-hierarchies-outliner
- **Difficulty: Easy–Medium** — a tree view bound to the scene graph.

### MATERIALS & DISPLAY

#### Paint Bucket + Materials ⚠️ — `B` (Sample = `Alt`)
- Applies a material (solid color or photo texture) to faces/edges; `Alt` samples an existing material.
- Doc: https://help.sketchup.com/en/sketchup/applying-materials
- **Difficulty:** Easy for color (we have it); **Medium** to add textures (three.js texture maps + UV positioning) and the eyedropper sample.

#### Styles (edge & face render modes) 🆕 — `Window > Styles`
- Wireframe, Hidden Line, Shaded, Shaded With Textures, Monochrome, X-Ray, Back Edges; styles are saved bundles of edge/face/background settings.
- Docs: https://help.sketchup.com/en/sketchup/choosing-style · https://help.sketchup.com/en/face-style
- **Difficulty: Medium** — render modes are material swaps (Wireframe = `wireframe:true`; X-Ray = transparent/`depthWrite:false`; Monochrome = flat; Hidden Line = `EdgesGeometry` + white faces). Sketchy-edge NPR is Hard.

#### Shadows (sun by date/time) 🆕 — `View > Shadows`
- Real sun shadow whose angle is driven by Time/Date sliders + Light/Dark intensity.
- Doc: https://help.sketchup.com/en/sketchup/casting-real-world-shadows
- **Difficulty: Medium** — `DirectionalLight` + `PCFSoftShadowMap`; date/time/lat-long → sun vector is a known solar-position formula.

#### Fog 🆕 — `View > Fog` — **Easy** — `scene.fog = new THREE.Fog(color, near, far)`.
- Doc: https://help.sketchup.com/en/sketchup/casting-real-world-shadows (Fog cross-referenced)

#### Scenes (saved camera + style views) 🆕 — `Window > Scenes`
- Saves a named view bundling camera, style, fog, shadow time, tag/hidden visibility, section planes, axes; sequenceable into animation.
- Doc: https://help.sketchup.com/en/sketchup/creating-scenes
- **Difficulty: Medium** — serialize camera + state snapshot; tween between two camera states.

### SOLID TOOLS (Pro, except Outer Shell)

> All require solids (closed, leak-free volumes) as groups/components. Maps to **three-bvh-csg**. All NEW — high value.
- **Outer Shell** (free) — merge overlapping solids, drop interior geometry. **Medium** (CSG union + drop internal shells).
- **Union** — combine solids keeping internal voids. **Medium** (`ADDITION`).
- **Subtract** — first solid removes its overlap from the second, then is deleted. **Medium** (`SUBTRACTION`).
- **Trim** — like Subtract but the cutter remains. **Medium**.
- **Intersect** — keep only the overlapping volume. **Medium** (`INTERSECTION`).
- **Split** — divide overlapping solids into separate pieces (union + both differences). **Medium–Hard** (3 outputs).
- Doc: https://help.sketchup.com/en/sketchup/modeling-complex-3d-shapes-solid-tools

### SANDBOX / TERRAIN (TIN mesh) 🆕
- **From Contours** — loft a TIN between contour lines. **Hard** (contour→TIN triangulation).
- **From Scratch** — flat rectangular grid TIN. **Easy** (subdivided `PlaneGeometry`).
- **Smoove** — raise/lower a radius of vertices with smooth falloff. **Medium** (radial brush).
- **Stamp** — flatten a patch to an object footprint + skirt it in. **Hard**.
- **Drape** — project edges down onto the TIN. **Hard** (project + re-mesh).
- **Add Detail** — subdivide TIN faces for finer sculpting. **Medium**.
- **Flip Edge** — swap a shared diagonal to fix flat spots. **Easy–Medium**.
- Docs: https://help.sketchup.com/en/sketchup/creating-terrain-scratch · https://help.sketchup.com/en/sketchup/sculpting-and-fine-tuning-terrain

### INFERENCE ENGINE 🆕 (the hard, high-value differentiator)

> Color convention: black on raw geometry, magenta inside a group/component, axis-colored (red/green/blue) for linear locks.
> Docs: https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts

- **Point inferences** — Endpoint, Midpoint, Arc Midpoint, Intersection, On Face, On Edge, Center, Origin, Guide Point, On Section. **Hard** — spatial queries (nearest vertex/edge/face, ray-edge & ray-face intersection), screen-space tolerance, priority ranking, live cursor feedback. The single highest-value/highest-effort feature.
- **Linear inferences** — On Red/Green/Blue Axis, From Point, Parallel, Extend Edge (collinear), Perpendicular (to edge/face), Tangent at Vertex. **Hard** — project cursor onto candidate direction lines, rank by screen distance, render colored guides.
- **Locking inferences (Shift / arrow keys)** — `Shift` locks the current direction/plane; ↑ Blue, ← Green, → Red ("Right locks Red"), ↓ parallel/perp to a referenced edge. **Medium** (given the engine exists) — hold a locked vector, project cursor input onto it, bind the keys.

---

**Net for the roadmap:** Quick wins — Fog, From-Scratch terrain, Tags, render-mode style swaps, textures on the Paint Bucket, Rectangle/Circle/Polygon drawing. Medium lifts — Groups/Components (foundational reuse), Section Plane, Solid Tools (three-bvh-csg), Shadows, Scenes, Dimensions. The big, defensible differentiator is the **Inference/snapping engine** — hardest to build, but it's what makes a web CAD tool feel like SketchUp rather than a toy.
