# Tutorial: Proximity Sliding Door (BP_Door + Actor Sequence)

This tutorial builds a proximity-triggered sliding door Blueprint (`BP_Door`) that plays an **Actor Sequence** to slide two door panels open when the player enters a box trigger, and closes when they leave.

Target context we were working in:

- Level: `SlidingDoor.umap` (package `/Game/SlidingDoor`)
- Blueprint: `/Game/ThirdPerson/Blueprints/BP_Door`
- Player character to filter overlaps: `/Game/ThirdPerson/Blueprints/BP_ThirdPersonCharacter`
- Meshes:
  - Door frame: `/Game/StarterContent/Props/SM_DoorFrame`
  - Door panels: `/Game/StarterContent/Props/SM_GlassWindow`

## 1) Create the Door Blueprint

1. Create a new Blueprint Class: `Actor` named `BP_Door`.
2. Open `BP_Door` and add components:
   - `DoorFrame` (StaticMesh): set to `SM_DoorFrame`
   - `DoorRight` (StaticMesh): set to `SM_GlassWindow`
   - `DoorLeft` (StaticMesh): set to `SM_GlassWindow`
   - `Box` (Box Collision)
   - `DoorOpenSequence` (Actor Sequence)

**Comment:** Keep the component names stable (`DoorRight`, `DoorLeft`). If you rename/recreate them after adding sequence tracks, Sequencer bindings can break and show in red (“object bound missing”).

## 2) Fix the Component Hierarchy (Important)

In the Components panel, ensure there is a single root tree.

1. Pick a root (either `DefaultSceneRoot` or make `DoorFrame` the root).
2. Attach under the root:
   - `DoorFrame`
   - `DoorRight`
   - `DoorLeft`
   - `Box`
   - `DoorOpenSequence`
3. Compile + Save.

**Comment:** We saw a case where `DoorFrame`, `DoorRight`, `DoorLeft`, `Box`, and `DoorOpenSequence` looked like separate roots. That makes transforms and sequence bindings less predictable.

## 3) Position the Panels and Trigger

1. Position `DoorRight` and `DoorLeft` inside the frame so they meet in the center.
2. Resize and position `Box` so the player entering the doorway overlaps it.

**Comment:** Prefer scaling the placed `BP_Door` actor in the level, not scaling `SM_DoorFrame` directly inside the Blueprint (unless you have a clear reason). Scaling inside the BP can make later adjustments harder.

## 4) Author the DoorOpenSequence (Actor Sequence)

1. Select `DoorOpenSequence` component and open it (Actor Sequence editor).
2. Add tracks:
   - `+ Track` → `Component` → `DoorRight`
     - Add `Transform` track
   - `+ Track` → `Component` → `DoorLeft`
     - Add `Transform` track
3. Add keyframes for sliding:
   - At time `0.0s`: both doors at **closed** position.
   - At time `0.7s` (example):
     - `DoorRight` moved along local Y (or X depending on your orientation) to the **right/open** position.
     - `DoorLeft` moved along local Y (or X) to the **left/open** position.

**Comment:** Only animate the axis you need (usually one translation axis). Keeping tracks minimal reduces jitter and accidental drift.

### Ease In/Out (Smoother Motion)

1. Select the transform keys.
2. Set key interpolation to `Auto` / `Cubic` (wording varies) for ease-in/ease-out.
3. If available, open the Curve Editor and adjust tangents.

**Comment:** If you can’t see curves, you may not be in the Curve Editor view. Also, selecting an *actor* binding vs a *component* binding changes what shows in the Details panel.

## 5) Close Animation Options

Actor Sequence reversal is not always exposed the same way as Level Sequence (you may not get a usable “Sequence Player” with reverse controls).

Pick one option:

1. **Recommended:** Create a second Actor Sequence component `DoorCloseSequence` and author the reverse motion (open → closed).
2. **Alternative:** Use a `Timeline` in the Blueprint to drive door panel translation.
3. **Alternative:** Use a Level Sequence / Template Sequence where you can reliably reverse playback.

## 6) Blueprint Logic (Overlap → Play)

### Add overlap events

1. Select `Box` component.
2. In Details → Events, add:
   - `OnComponentBeginOverlap`
   - `OnComponentEndOverlap`

### Filter to player character

In Event Graph:

1. On BeginOverlap:
   - Use `Other Actor` → `Cast To BP_ThirdPersonCharacter`
   - On Cast Success: `DoorOpenSequence` → `Play` (or equivalent play node for Actor Sequence component)
2. On EndOverlap:
   - Use `Other Actor` → `Cast To BP_ThirdPersonCharacter`
   - On Cast Success:
     - If you created `DoorCloseSequence`: `DoorCloseSequence` → `Play`
     - Otherwise: implement close via Timeline / alternative method

**Comment:** The cast is important so random overlaps (physics props, AI, etc.) don’t open the door.

## 7) Place and Test in the Level

1. Open `/Game/SlidingDoor`.
2. Drag `BP_Door` into the level.
3. Press Play and walk into/out of the `Box` trigger.

---

## Q&A / Troubleshooting

### Q: “DoorOpenSequence: the object bound to this track is missing” (track is red)

A: The sequence is bound to a component/object that no longer matches the Blueprint (commonly after renaming/recreating components).

Fix (fastest):

1. In `BP_Door`, confirm `DoorRight`/`DoorLeft` components exist and are named correctly. Compile + Save.
2. Open `DoorOpenSequence`.
3. Delete the red missing track(s).
4. Re-add: `+ Track` → `Component` → `DoorRight` / `DoorLeft`.

If your Sequencer UI shows a rebinding option:

1. Right-click the missing binding/track.
2. Use `Rebind` / `Assign` / `Fix Binding` and choose the correct component.

### Q: In Sequencer, I’m looking at Details and only see “Category: Actor”

A: You’ve selected an **actor binding**. For an Actor Sequence inside `BP_Door`, you usually want **component bindings**.

Fix:

1. Ensure you created tracks via `+ Track` → `Component` → `DoorRight` / `DoorLeft`.
2. If you added an actor track by mistake, delete it and add component tracks instead.

### Q: I can’t add `+ Track` → `Component` → `DoorRight` (it doesn’t appear)

A: Common causes:

1. `DoorRight` doesn’t exist anymore, or got renamed.
2. The Blueprint wasn’t compiled after component changes.
3. The sequence editor is stale.

Fix:

1. Verify `DoorRight` exists in Components.
2. Compile + Save `BP_Door`.
3. Close and reopen `DoorOpenSequence`.

### Q: I can’t find the Curve Editor / curves don’t show

A: You may be in the main Sequencer track view without the curve editor panel enabled, or you’re selecting a binding that doesn’t have animated properties.

Fix:

1. Select the transform keys you created.
2. Switch to/show Curve Editor (if your layout supports it).
3. If Curve Editor isn’t available for Actor Sequence in your setup, set key interpolation (Auto/Cubic) from the key context menu.

### Q: How do I reverse the Actor Sequence to close the door?

A: In our setup, Actor Sequence didn’t expose a reliable sequence player with reverse controls (unlike Level Sequence player workflows).

Use one of:

1. Create `DoorCloseSequence` (reverse animation authored explicitly).
2. Use a Blueprint `Timeline` to drive translation and reverse the timeline.
3. Switch to a Level Sequence/Template Sequence solution.

### Q: My door panels move weirdly when I place multiple doors

A: Usually caused by components not being attached under one root, or animating world-space transforms instead of component transforms.

Fix:

1. Ensure a single rooted component hierarchy.
2. Animate the `DoorRight`/`DoorLeft` component transforms in the Actor Sequence.
