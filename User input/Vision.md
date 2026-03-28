
## Long term goals

- AI must be able to interact directly with the data/canvases. Add an MCP Server? 
- Have the visual canvas live side-by-side with a note editor that displays the currently selected card. All relationships should be visible in the note, together with any markdown notes.
- Have multiple canvases, we will call them "models".
- Be able to edit the notes and have the canvas update automatically in some basic way. Our robust card handing with Push Mode will make further adjustments easy.
- Just a canvas and note panel. I want to lean into the "canvas-first"-principle.
- Card alignment functionality

## Design principles

- No card overlaps. We will strive to never have cards overlapping and obscuring each other. It is not something that will ever be necessary when modelling with DSRP, and a common pain point in other whiteboard apps. Our Push Mode is designed exactly to address this, and is the "killer feature" of the app.
- Canvas-first. We will strive to have almost all interactions take place on the canvas if possible. 
- Focused. The app should remove choices from the user. The core functionality should be intuitive and guide the user into proper DSRP practices. We don't strive to model everything, we won't have lots of shapes and icons and customizability. This is not primarily a tool for presentation, it is a tool for thinking. And the less distractions, the more focused thinking you get.
- 