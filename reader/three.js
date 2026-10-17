import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export * from "three";
export { OrbitControls };

/** A component-owned viewport: no global loop, offscreen work, or retained GPU resources. */
export function createThreeViewport({
  element,
  signal,
  onFrame,
  onRender,
  onPlaybackChange,
  background = 0xf3f5f1,
  controls: withControls = true,
}) {
  if (signal?.aborted) throw new Error("The component has been closed");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(background, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText =
    "display:block;width:100%;height:100%;touch-action:pan-y";
  element.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  camera.position.set(80, 55, 95);
  const controls = withControls ? new OrbitControls(camera, canvas) : null;
  if (controls) {
    controls.enableDamping = false;
    controls.enablePan = false;
  }
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = false,
    visible = true,
    playing = false,
    previous = null,
    elapsed = 0;
  function render() {
    if (!disposed) {
      renderer.render(scene, camera);
      onRender?.({ scene, camera, renderer });
    }
  }
  function tick(now) {
    if (disposed) return;
    const delta =
      previous === null ? 0 : Math.min((now - previous) / 1000, 0.05);
    previous = now;
    elapsed += delta;
    onFrame?.({ delta, elapsed });
    render();
  }
  function updateLoop() {
    previous = null;
    renderer.setAnimationLoop(
      playing && visible && !document.hidden && !disposed ? tick : null,
    );
  }
  function setPlaying(value) {
    const changed = playing !== Boolean(value);
    playing = Boolean(value);
    updateLoop();
    if (changed) onPlaybackChange?.(playing);
  }
  function resize() {
    if (disposed) return;
    const { width, height } = element.getBoundingClientRect();
    const w = Math.max(1, width),
      h = Math.max(1, height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);
  const visibilityObserver = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    updateLoop();
    if (visible) render();
  });
  visibilityObserver.observe(element);
  const visibilityChanged = () => updateLoop();
  const motionChanged = () => {
    if (media.matches) setPlaying(false);
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  media.addEventListener("change", motionChanged);
  controls?.addEventListener("change", render);
  function dispose() {
    if (disposed) return;
    disposed = true;
    playing = false;
    updateLoop();
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    document.removeEventListener("visibilitychange", visibilityChanged);
    media.removeEventListener("change", motionChanged);
    signal?.removeEventListener("abort", dispose);
    controls?.dispose();
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        if (material) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value?.isTexture) textures.add(value);
        }
    });
    for (const resource of [...textures, ...materials, ...geometries])
      resource.dispose();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  signal?.addEventListener("abort", dispose, { once: true });
  resize();
  return {
    scene,
    camera,
    controls,
    renderer,
    render,
    resize,
    setPlaying,
    dispose,
    get reducedMotion() {
      return media.matches;
    },
    get playing() {
      return playing;
    },
  };
}
