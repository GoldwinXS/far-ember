// Ember Squad: post-processing. Ambient occlusion, bloom, tone mapping and a light grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const Grade = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uSat: { value: 1.06 }, uContrast: { value: 1.05 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 }, uLift: { value: 0.03 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform float uContrast; uniform vec3 uTint; uniform float uTime; uniform float uLift;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.4) * uContrast + 0.4;
      // lift the shadows (a stand-in for bounce light): strongest at black, gone by mid grey
      float ls = dot(max(col, 0.0), vec3(0.2126, 0.7152, 0.0722));
      col += uLift * (1.0 - smoothstep(0.0, 0.4, ls)) * vec3(1.0, 0.97, 0.94);
      col *= uTint;
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVig * smoothstep(0.25, 0.85, length(d * vec2(1.15, 1.0)));
      col += (hash(vUv * 731.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.88);
    this.output = new OutputPass();
    this.grade = new ShaderPass(Grade);
    for (const p of [this.render, this.ao, this.bloom, this.output, this.grade]) this.composer.addPass(p);
    // Keep see-through things (smoke, sprites, overlays) out of the occlusion pass, or they read as solid walls.
    const aoRender = this.ao.render.bind(this.ao);
    this.ao.render = (...args) => {
      const hidden = [];
      scene.traverse((o) => {
        if (o.visible && (o.userData.noAO || o.isSprite || o.isPoints || o.isLine || (o.material && o.material.transparent && !o.material.depthWrite))) { o.visible = false; hidden.push(o); }
      });
      aoRender(...args);
      for (const o of hidden) o.visible = true;
    };
  }
  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }
  setLook(o) {
    const u = this.grade.uniforms;
    if (o.vig !== undefined) u.uVig.value = o.vig;
    if (o.sat !== undefined) u.uSat.value = o.sat;
    if (o.contrast !== undefined) u.uContrast.value = o.contrast;
    if (o.tint) u.uTint.value.set(...o.tint);
    if (o.lift !== undefined) u.uLift.value = o.lift;
    if (o.bloom !== undefined) this.bloom.strength = o.bloom;
    if (o.ao !== undefined) this.ao.enabled = o.ao;
  }
  frame(t) {
    this.grade.uniforms.uTime.value = t % 100;
    this.composer.render();
  }
}
