// Page entry. The skill kit (public/assets: system.js, motion.js, layout.js) runs the nav, the hero's
// entrance, the hover layer, the effect and the moments; this file adds only the project's own parts.
import './styles/tokens.css';
import './styles/hud.css';
import './styles/vehicle-stage.css';
import './styles/page.css';
import './styles/story.css';
import { initVehicleStages } from './vehicle/stage.js';
import { initStory } from './story/story.js';
import { initSignature } from './story/signature.js';

initVehicleStages();
initStory();
initSignature();
