import * as THREE from 'three';

/**
 * Shading shared by every miniature material. A miniature has almost no light: surfaces
 * are their own colour, with only a faint difference between faces. Zoomed in, the
 * direct share and the cast shadows fade up so the city gains depth.
 */
export const shading = {
  uAmbient: { value: 0.8 },
  uDirect: { value: 0.2 },
  /** 0 = no cast shadows at all, 1 = full shadows. */
  uShadow: { value: 0 },
};

const cache = new Map<string, THREE.MeshLambertMaterial>();

export interface MiniOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  side?: THREE.Side;
}

/**
 * A Lambert material whose final colour is replaced with the miniature formula. Lambert
 * still does the heavy lifting (instancing, vertex colours, maps, the shadow lookup), and
 * only the last line of the lighting is ours.
 */
export function miniMaterial(opts: MiniOptions = {}): THREE.MeshLambertMaterial {
  const color = new THREE.Color(opts.color ?? '#ffffff');
  const key = `${color.getHexString()}|${opts.map?.uuid ?? ''}|${opts.vertexColors === true}|${opts.side ?? 0}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const m = new THREE.MeshLambertMaterial({
    color,
    map: opts.map ?? null,
    vertexColors: opts.vertexColors === true,
    side: opts.side ?? THREE.FrontSide,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shading);
    shader.fragmentShader =
      'uniform float uAmbient;\nuniform float uDirect;\nuniform float uShadow;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        float miniLight = 0.0;
        float miniShadow = 1.0;
        #if NUM_DIR_LIGHTS > 0
          miniLight = max(dot(normal, directionalLights[0].direction), 0.0);
          #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
            DirectionalLightShadow miniDls = directionalLightShadows[0];
            miniShadow = receiveShadow
              ? getShadow(directionalShadowMap[0], miniDls.shadowMapSize, miniDls.shadowIntensity,
                          miniDls.shadowBias, miniDls.shadowRadius, vDirectionalShadowCoord[0])
              : 1.0;
          #endif
        #endif
        miniShadow = mix(1.0, miniShadow, uShadow);
        outgoingLight = diffuseColor.rgb * (uAmbient + uDirect * miniLight * miniShadow);
        #include <opaque_fragment>`,
      );
  };
  cache.set(key, m);
  return m;
}

/** Marks an object for the ink pass. Children inherit unless they set their own. */
export function setInkClass(obj: THREE.Object3D, inkClass: number): void {
  obj.userData.inkClass = inkClass;
}

/** Objects that are drawn but must never produce outlines: cursors, previews, overlays. */
export function markOverlay(obj: THREE.Object3D): void {
  obj.userData.overlay = true;
}
