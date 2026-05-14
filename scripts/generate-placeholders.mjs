import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

// GLTFExporter uses browser FileReader for buffer → data URL in Node
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    readAsDataURL(blob) {
      Promise.resolve(blob.arrayBuffer())
        .then((ab) => {
          const b64 = Buffer.from(ab).toString("base64");
          this.result = `data:application/octet-stream;base64,${b64}`;
          queueMicrotask(() => this.onloadend?.());
        })
        .catch(() => {});
    }
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer())
        .then((ab) => {
          this.result = ab;
          queueMicrotask(() => this.onloadend?.());
        })
        .catch(() => {});
    }
  };
}

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "assets", "placeholders");
fs.mkdirSync(outDir, { recursive: true });

const exporter = new GLTFExporter();

async function writeGltf(name, object3d) {
  const scene = new THREE.Scene();
  scene.name = name.replace(".gltf", "");
  scene.add(object3d);
  const gltf = await exporter.parseAsync(scene, {
    binary: false,
    embedImages: true,
    onlyVisible: true,
  });
  const dest = path.join(outDir, name);
  fs.writeFileSync(dest, JSON.stringify(gltf));
  console.log("Wrote", dest);
}

function meshBox(w, h, d, color, x = 0, y = h / 2, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function meshSphere(r, color, x = 0, y = r, z = 0) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function meshCylinder(rt, rb, h, color, x = 0, y = h / 2, z = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, 20);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Ceez ~1.8m tall: body + head cap as group
const ceez = new THREE.Group();
const body = meshBox(0.55, 1.45, 0.35, 0xb83232, 0, 0.725, 0);
const head = meshBox(0.38, 0.35, 0.34, 0x1a1a1a, 0, 1.45 + 0.175, 0);
ceez.add(body, head);

// Pivot at center for shoulder parenting in code
const ray = meshSphere(0.125, 0x6b6b6b, 0, 0, 0);

// Ground: 10m along Z, 4m along X, thin
const ground = meshBox(4, 0.15, 10, 0x2a2a32, 0, 0.075, 0);

const obstacle = meshBox(0.95, 1.1, 0.95, 0x8c9096, 0, 0.55, 0);

const coin = meshCylinder(0.22, 0.22, 0.08, 0xd4a017, 0, 0.04, 0);
coin.rotation.x = Math.PI / 2;

const banana = new THREE.Group();
const b1 = meshCylinder(0.08, 0.12, 0.45, 0xe8c840, 0, 0.225, 0);
banana.add(b1);

await writeGltf("ceez_placeholder.gltf", ceez);
await writeGltf("ray_placeholder.gltf", ray);
await writeGltf("ground_tile.gltf", ground);
await writeGltf("obstacle_box.gltf", obstacle);
await writeGltf("coin_collectible.gltf", coin);
await writeGltf("banana_projectile.gltf", banana);

console.log("Done.");
