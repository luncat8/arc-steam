in horizontal layout:

time controls, new game, other system
--------
telemetry
--------
tech research | canvas | controls | MINERAL INSPECTOR
--------
equipment | cargo | market


below canvas is legend and view mode change. this is typical prompt for mode change (may not fit this project, i just copy paste it so think before use) :


View-mode menu (click + pointer hover)

Add a single-source view-mode switcher where a radio menu can be changed by click or by hovering, following this contract:

Markup: A container holds one <label> per mode. Each label wraps an <input type="radio" name="<group>" value="<id>"> and the mode label text. Exactly one radio may be checked at a time.
Single writer: setMode(id) is the only function that changes the active mode. It returns immediately if id is already active; otherwise it updates the single source of truth and marks the view dirty. Click, keyboard, and hover all call this function.
Click handler: Listen for change on the container. If event.target is a radio with the group name, call setMode(event.target.value).
Hover handler: Listen for pointerover on the container. Walk event.target up through its parents until reaching the container or a <LABEL>; stop if neither is found. Within the label, find the child input whose name matches the group, set input.checked = true, then call setMode(input.value).
Device gating: Enable hover switching only when matchMedia('(hover: hover) and (pointer: fine)').matches is true. Touch/stylus-only devices must remain click-only.
Render: The render loop reads the current mode from the single source of truth, not from DOM state, and redraws when dirty.
Hot path: Do not allocate closures or object literals inside the hover/pointer-move listeners; reuse preallocated scratch where needed.