import { getDomElements, markPending } from './viewer/dom.js';
import { HyperspectralViewer } from './viewer/controller.js';

async function startViewer() {
  const elements = getDomElements();
  markPending(elements);

  const viewer = new HyperspectralViewer(elements);
  await viewer.init();
}

startViewer().catch((error) => {
  console.error('Failed to start hyperspectral viewer', error);
});
