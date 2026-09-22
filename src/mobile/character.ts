import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { outfitFor } from './outfits';

export type Look = { shirt: string; skin: string; hair: string; outfit?: string };
const models = new Map<string, Promise<GLTF>>();
function load(name: string) {
  let pending = models.get(name);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(`/models/quaternius/${name}.gltf`).catch(error => { models.delete(name); throw error; });
    models.set(name, pending);
  }
  return pending;
}

/** One cached download, independent skeletons and wardrobe colors for every guest. */
export class Character {
  readonly group = new T.Group();
  private model?: T.Object3D;
  private mixer?: T.AnimationMixer;
  private actions = new Map<string, T.AnimationAction>();
  private current?: T.AnimationAction;
  private started = false;
  private removed = false;
  private revision = 0;
  status = 'Loading character…';
  private colors: { material: T.MeshStandardMaterial; channel: 'shirt' | 'skin' | 'hair'; shade: number }[] = [];
  private ownedMaterials: T.Material[] = [];
  private fallback: T.Mesh;
  constructor(private look: Look, private dealer = false) {
    // A compact silhouette remains usable if a download fails or while it loads.
    this.fallback = new T.Mesh(new T.CapsuleGeometry(.25, 1.05, 4, 8), new T.MeshStandardMaterial({ color: look.shirt }));
    this.fallback.position.y = .85; this.group.add(this.fallback);
  }
  setLook(look: Look) {
    const changed = !this.dealer && outfitFor(look.outfit).id !== outfitFor(this.look.outfit).id;
    this.look = look;
    if (changed) { this.revision++; this.started = false; this.status = 'Loading character…'; }
    (this.fallback.material as T.MeshStandardMaterial).color.set(look.shirt);
    for (const { material, channel, shade } of this.colors) material.color.set(look[channel]).multiplyScalar(shade);
  }
  private async prepare() {
    this.started = true;
    const revision = this.revision;
    const outfit = outfitFor(this.dealer ? 'Suit' : this.look.outfit);
    try {
      const gltf = await load(outfit.id);
      if (this.removed || revision !== this.revision) return;
      this.releaseModel();
      this.model = clone(gltf.scene);
      this.model.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        const copy = (source: T.Material) => {
          const mat = source.clone() as T.MeshStandardMaterial;
          this.ownedMaterials.push(mat); mat.roughness = .88;
          const name = source.name;
          const channel = name.startsWith('Skin') ? 'skin' : outfit.hair.includes(name) ? 'hair' : !this.dealer && outfit.shirt.includes(name) ? 'shirt' : null;
          if (channel) this.colors.push({ material: mat, channel, shade: name === 'Skin_Darker' ? .8 : 1 });
          if (this.dealer && name === 'Suit') mat.color.set('#192d3d');
          if (this.dealer && name === 'Tie') mat.color.set('#d6ad62');
          return mat;
        };
        node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
        node.castShadow = true; node.receiveShadow = true;
        // Animated bounds must follow the pose rather than the export frame.
        node.frustumCulled = false;
      });
      this.mixer = new T.AnimationMixer(this.model);
      for (const name of ['Idle', 'Walk']) {
        const clip = gltf.animations.find(a => a.name === name);
        if (clip) this.actions.set(name, this.mixer.clipAction(clip));
      }
      this.current = this.actions.get('Idle'); this.current?.play(); this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(this.model);
      const scale = 1.95 / (bounds.max.y - bounds.min.y);
      this.model.scale.multiplyScalar(scale);
      this.model.position.y -= bounds.min.y * scale;
      this.group.add(this.model); this.fallback.visible = false; this.setLook(this.look);
      this.status = outfit.id === 'Spacesuit' ? 'Helmet covers skin and hair colors.' : `${outfit.name} · Ready`;
    } catch (error) {
      if (this.removed || revision !== this.revision) return;
      this.status = 'Could not load this outfit. Choose another and try again.';
      console.warn('Character model unavailable; keeping the guest silhouette.', error);
    }
  }
  update(dt: number, moving = false, seated = false) {
    if (!this.started) void this.prepare();
    if (!this.mixer || !this.model) return;
    const next = this.actions.get(moving && !seated ? 'Walk' : 'Idle');
    if (next && next !== this.current) {
      this.current?.fadeOut(.2); next.reset().fadeIn(.2).play(); this.current = next;
    }
    this.mixer.update(dt);
    if (seated) {
      // The pack has no sitting clip. Pose the legs after the idle animation,
      // keeping its breathing and hand motion; bone local Y follows the limb.
      this.model.updateMatrixWorld(true);
      const rotation = this.group.getWorldQuaternion(new T.Quaternion());
      for (const side of ['L', 'R']) {
        for (const [part, direction] of [['UpperLeg', new T.Vector3(0, 0, 1)], ['LowerLeg', new T.Vector3(0, -1, 0)]] as const) {
          const bone = this.model.getObjectByName(`${part}${side}`) ?? this.model.getObjectByName(`${part}.${side}`);
          if (!bone?.parent) continue;
          const world = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction.clone().applyQuaternion(rotation));
          bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world));
          bone.updateMatrixWorld(true);
        }
      }
    }
  }
  private releaseModel() {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    // Geometry belongs to the shared loader cache, not this instance.
    for (const mat of this.ownedMaterials) mat.dispose();
    this.model?.removeFromParent(); this.model = undefined; this.mixer = undefined;
    this.actions.clear(); this.current = undefined; this.colors = []; this.ownedMaterials = [];
  }
  dispose() {
    this.removed = true; this.revision++; this.releaseModel();
    for (const child of this.group.children) {
      if (child === this.model || child === this.fallback || !(child instanceof T.Mesh)) continue;
      child.geometry.dispose();
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) {
        if ('map' in mat && mat.map instanceof T.Texture) mat.map.dispose();
        mat.dispose();
      }
    }
    this.fallback.geometry.dispose(); (this.fallback.material as T.Material).dispose();
    this.group.removeFromParent();
  }
}
