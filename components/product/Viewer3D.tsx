"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Center, ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* Contours identiques aux placeholders 2D (dessin original, unités SVG) */
const FRAME =
  "M -540 -170 C -360 -262 360 -262 540 -170 C 612 -128 626 40 586 160 C 556 246 470 282 330 280 C 230 278 170 262 120 214 C 80 172 40 150 0 150 C -40 150 -80 172 -120 214 C -170 262 -230 278 -330 280 C -470 282 -556 246 -586 160 C -626 40 -612 -128 -540 -170 Z";
const LENS =
  "M -498 -138 C -330 -218 330 -218 498 -138 C 556 -104 566 34 534 134 C 510 206 440 234 326 232 C 238 230 188 216 146 176 C 104 136 52 112 0 112 C -52 112 -104 136 -146 176 C -188 216 -238 230 -326 232 C -440 234 -510 206 -534 134 C -566 34 -556 -104 -498 -138 Z";

const ECHELLE = 1 / 280; // unités SVG → unités 3D (largeur ≈ 4,3)
const RAYON = 2.6; // rayon de courbure du masque autour du visage

function forme(d: string) {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  return SVGLoader.createShapes(data.paths[0])[0];
}

/** Enroule une géométrie autour d'un cylindre vertical (courbure du masque) et retourne l'axe Y (SVG → 3D).
 *  La géométrie est d'abord subdivisée pour que la courbure soit lisse (pas de facettes). */
function courber(source: THREE.BufferGeometry, lisse = true) {
  const fine = new TessellateModifier(36, 8).modify(source.index ? source.toNonIndexed() : source);
  fine.deleteAttribute("normal");
  fine.deleteAttribute("uv");
  const g = lisse ? mergeVertices(fine, 0.5) : fine;
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * ECHELLE;
    const y = -p.getY(i) * ECHELLE;
    const z = p.getZ(i) * ECHELLE;
    const a = x / RAYON;
    const r = RAYON + z;
    p.setXYZ(i, Math.sin(a) * r, y, Math.cos(a) * r - RAYON);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function MasqueProcedural({ teinte }: { teinte: string }) {
  const { monture, verre, mousse, sangle } = useMemo(() => {
    const cadre = forme(FRAME);
    cadre.holes.push(new THREE.Path(forme(LENS).getPoints(64)));
    const monture = courber(new THREE.ExtrudeGeometry(cadre, { depth: 60, bevelEnabled: true, bevelThickness: 14, bevelSize: 10, bevelSegments: 4, curveSegments: 48 }));
    const verre = courber(new THREE.ExtrudeGeometry(forme(LENS), { depth: 8, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 2, curveSegments: 48 }).translate(0, 0, 58));
    const mousse = courber(new THREE.ExtrudeGeometry(cadre, { depth: 70, bevelEnabled: false, curveSegments: 48 }).translate(0, 0, -70));
    // Sangle : bande ouverte (cercle de rayon 2, centré 1,35 derrière) qui rejoint les bords de la monture
    const debut = Math.atan2(1.86, 0.78);
    const sangle = new THREE.CylinderGeometry(2, 2, 0.42, 96, 1, true, debut, Math.PI * 2 - debut * 2);
    return { monture, verre, mousse, sangle };
  }, []);

  return (
    <group rotation={[0, 0, 0]}>
      <mesh geometry={monture} castShadow>
        <meshPhysicalMaterial color="#141b25" roughness={0.38} metalness={0.15} clearcoat={0.6} clearcoatRoughness={0.3} />
      </mesh>
      <mesh geometry={verre}>
        <meshPhysicalMaterial
          color={teinte}
          roughness={0.04}
          metalness={0.85}
          clearcoat={1}
          clearcoatRoughness={0.02}
          iridescence={1}
          iridescenceIOR={1.6}
          iridescenceThicknessRange={[200, 900]}
          envMapIntensity={1.6}
        />
      </mesh>
      <mesh geometry={mousse}>
        <meshStandardMaterial color="#2a3442" roughness={1} />
      </mesh>
      <mesh geometry={sangle} position={[0, 0.05, -1.35]}>
        <meshStandardMaterial color="#1e2733" roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function MasqueGLB({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

/**
 * Vue 3D interactive (rotation à la souris / au doigt, zoom).
 * - `glb` fourni → charge votre modèle (ex. /products/modele-01/modele.glb)
 * - sinon → masque procédural teinté avec la couleur du verre
 */
export default function Viewer3D({ glb, teinte, fond = "#E9EEF3" }: { glb?: string | null; teinte: string; fond?: string }) {
  return (
    <Canvas camera={{ position: [0, 0.6, 10.5], fov: 32 }} dpr={[1, 2]} shadows gl={{ antialias: true, preserveDrawingBuffer: false }} style={{ touchAction: "none" }}>
      <color attach="background" args={[fond]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} castShadow />
      <Suspense fallback={null}>
        <Center>{glb ? <MasqueGLB url={glb} /> : <MasqueProcedural teinte={teinte} />}</Center>
        {/* Éclairage studio local (aucun fichier HDR externe) */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3} position={[0, 4, 4]} scale={[10, 2, 1]} />
          <Lightformer form="rect" intensity={2} color="#cfe3ff" position={[-5, 1, 2]} scale={[3, 6, 1]} rotation-y={Math.PI / 2} />
          <Lightformer form="rect" intensity={2} color="#ffd9c2" position={[5, 0, 2]} scale={[3, 6, 1]} rotation-y={-Math.PI / 2} />
          <Lightformer form="ring" intensity={1.5} position={[0, -2, 6]} scale={3} />
        </Environment>
      </Suspense>
      <ContactShadows position={[0, -1.15, 0]} opacity={0.35} scale={9} blur={2.6} far={3} />
      <OrbitControls enablePan={false} minDistance={6} maxDistance={14} autoRotate autoRotateSpeed={1.2} enableDamping />
    </Canvas>
  );
}
