import * as THREE from 'three';
import { PAL } from './palette';

/**
 * The miniature look, as three passes:
 *
 * 1. colour — the scene with the flat miniature materials, plus depth;
 * 2. normals + surface class — the same scene with every mesh swapped for a normal
 *    material whose alpha carries its ink class;
 * 3. composite — ink lines where depth, normals or class change, then paper grain and
 *    the aged tone towards the edges.
 *
 * Lines come from the image rather than from geometry, so every building, road and new
 * field is outlined without anyone having to author an outline.
 */
export class MiniPipeline {
  private readonly depthTexture: THREE.DepthTexture;
  private readonly rtColor: THREE.WebGLRenderTarget;
  private readonly rtNormal: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();
  private readonly composite: THREE.ShaderMaterial;
  private readonly normalMaterials = new Map<number, THREE.MeshNormalMaterial>();
  private readonly paper = new THREE.Color(PAL.paper);
  private readonly normalBackground = new THREE.Color(0.5, 0.5, 1);
  private pixelRatio = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.OrthographicCamera,
  ) {
    this.depthTexture = new THREE.DepthTexture(1, 1);
    this.depthTexture.type = THREE.FloatType;
    this.rtColor = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: this.depthTexture,
    });
    this.rtNormal = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtColor.texture },
        tDepth: { value: this.depthTexture },
        tNormal: { value: this.rtNormal.texture },
        texel: { value: new THREE.Vector2(1, 1) },
        depthRange: { value: 1 },
        lineScale: { value: 1 },
        ink: { value: new THREE.Color(PAL.ink) },
        paper: { value: new THREE.Color(PAL.paper) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite));
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    this.rtColor.setSize(w, h);
    this.rtNormal.setSize(w, h);
    (this.composite.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
    // Lines keep the same on-screen weight whatever the device's pixel density.
    this.composite.uniforms.lineScale.value = Math.max(1, pixelRatio * 0.9);
  }

  render(): void {
    const { renderer, scene, camera } = this;
    this.composite.uniforms.depthRange.value = camera.far - camera.near;
    scene.background = this.paper;
    renderer.setRenderTarget(this.rtColor);
    renderer.render(scene, camera);

    const restoreMaterials: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    const restoreHidden: THREE.Object3D[] = [];
    const walk = (obj: THREE.Object3D, inherited: number): void => {
      if (!obj.visible) return;
      if (obj.userData.overlay === true) {
        obj.visible = false;
        restoreHidden.push(obj);
        return;
      }
      const cls = typeof obj.userData.inkClass === 'number' ? obj.userData.inkClass : inherited;
      if (obj instanceof THREE.Mesh) {
        const mesh = obj as THREE.Mesh;
        restoreMaterials.push([mesh, mesh.material]);
        mesh.material = this.normalMaterial(cls);
      }
      for (const child of obj.children) walk(child, cls);
    };
    walk(scene, 0.1);
    // Shadow maps belong to the colour pass; the normal pass must not redraw them.
    const autoShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.background = this.normalBackground;
    renderer.setRenderTarget(this.rtNormal);
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = autoShadow;
    for (const [mesh, material] of restoreMaterials) mesh.material = material;
    for (const obj of restoreHidden) obj.visible = true;
    scene.background = this.paper;

    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  get devicePixelRatio(): number {
    return this.pixelRatio;
  }

  private normalMaterial(cls: number): THREE.MeshNormalMaterial {
    const key = Math.round(cls * 100);
    let m = this.normalMaterials.get(key);
    if (m === undefined) {
      // `transparent` with blending off: the only way to get the class into the alpha
      // channel, because opaque materials have their alpha forced to 1.
      m = new THREE.MeshNormalMaterial({ opacity: key / 100, transparent: true, blending: THREE.NoBlending });
      this.normalMaterials.set(key, m);
    }
    return m;
  }
}

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 texel;
  uniform float depthRange;
  uniform float lineScale;
  uniform vec3 ink;
  uniform vec3 paper;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float d0 = texture2D(tDepth, vUv).x * depthRange;
    vec4 n0s = texture2D(tNormal, vUv);
    vec3 n0 = normalize(n0s.xyz * 2.0 - 1.0);

    vec2 offs[4];
    offs[0] = vec2(1.0, 0.0);
    offs[1] = vec2(0.0, 1.0);
    offs[2] = vec2(0.7, 0.7);
    offs[3] = vec2(0.7, -0.7);

    float dEdge = 0.0;
    float nEdge = 0.0;
    float cEdge = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = offs[i] * texel * lineScale;
      // Depth: second difference, so a smooth slope seen at an angle is not mistaken for
      // an edge; only a real step (a wall, a roof line) survives.
      float a = texture2D(tDepth, vUv + o).x * depthRange;
      float b = texture2D(tDepth, vUv - o).x * depthRange;
      dEdge = max(dEdge, abs(a + b - 2.0 * d0));
      vec4 na = texture2D(tNormal, vUv + o);
      vec4 nb = texture2D(tNormal, vUv - o);
      nEdge = max(nEdge, 1.0 - dot(normalize(na.xyz * 2.0 - 1.0), n0));
      nEdge = max(nEdge, 1.0 - dot(normalize(nb.xyz * 2.0 - 1.0), n0));
      cEdge = max(cEdge, step(0.04, abs(na.a - n0s.a)));
      cEdge = max(cEdge, step(0.04, abs(nb.a - n0s.a)));
    }
    // A hand-drawn line is never perfectly even.
    float wobble = 0.85 + 0.3 * vnoise(gl_FragCoord.xy / (18.0 * lineScale));
    float edge = max(smoothstep(0.25, 0.7, dEdge * wobble), smoothstep(0.18, 0.45, nEdge * wobble));
    edge = max(edge, cEdge * 0.85);
    c = mix(c, ink, edge * 0.9);

    // Paper: fibre grain everywhere, and a warmer, older tone towards the page edges.
    vec2 px = gl_FragCoord.xy / lineScale;
    float grain = vnoise(px * 0.9) * 0.5 + vnoise(px * 0.23) * 0.5;
    c *= 0.935 + 0.075 * grain;
    vec2 q = (vUv - 0.5) * vec2(1.25, 1.0);
    float age = smoothstep(0.45, 0.85, length(q));
    c = mix(c, c * paper * 1.06, age * 0.5);

    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;
