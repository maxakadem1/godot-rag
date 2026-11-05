"use client";

/**
 * The Godot logo as a real 3D object: each part of the 2D logo is extruded into a
 * bevelled solid, the head is rendered as refractive blue glass, and it spins.
 *
 * The glass look: MeshTransmissionMaterial renders the scene behind the object into a
 * texture and samples it through the surface, bending it (ior), splitting colours
 * (chromaticAberration) and tinting it (attenuation). On a black page there would be
 * nothing to bend, so the refraction pass uses a studio of soft coloured lights
 * (the environment) as its background, while the page itself stays black.
 */
import { Environment, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { LogoMark } from "./logo";
import { GODOT_LOGO as L } from "@/lib/godot-logo";
import { cn } from "@/lib/utils";

const SCALE = 0.0021; // logo units (1024 wide) to scene units
const BEVEL = 14;

function shapesFromPath(d: string) {
  const svg = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
  return svg.paths.flatMap((p) => p.toShapes());
}

function circle({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

/**
 * Extrude 2D shapes into a solid centred on `z` (logo units). SVG's y axis points
 * down, so the geometry is turned half a turn about X: that puts it upright and
 * facing the other way, which is invisible because the logo is symmetric.
 */
function solid(shapes: THREE.Shape[], depth: number, z: number) {
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL * 0.8,
    bevelSegments: 6,
    curveSegments: 40,
  });
  g.rotateX(Math.PI); // z now runs from 0 to -depth
  g.translate(-512, 520, depth / 2 + z);
  return g;
}

function useLogoGeometry() {
  return useMemo(
    () => ({
      body: solid(shapesFromPath(L.body), 150, 0),
      band: solid(shapesFromPath(L.band), 100, 0),
      nose: solid(shapesFromPath(L.nose), 60, 70),
      eyes: solid(L.eyes.map(circle), 60, 80),
      pupils: solid(L.pupils.map(circle), 40, 115),
    }),
    [],
  );
}

function Logo({ reducedMotion, onFirstFrame }: { reducedMotion: boolean; onFirstFrame: () => void }) {
  const geo = useLogoGeometry();
  const frames = useRef(0);
  const group = useRef<THREE.Group>(null);
  const env = useThree((s) => s.scene.environment);
  const drag = useRef({ active: false, lastX: 0, velocity: 0 });
  const { gl } = useThree();

  // Drag to spin: horizontal pointer movement adds spin that decays back to the idle speed.
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      drag.current = { active: true, lastX: e.clientX, velocity: drag.current.velocity };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag.current.active) return;
      drag.current.velocity += (e.clientX - drag.current.lastX) * 0.012;
      drag.current.lastX = e.clientX;
    };
    const up = () => (drag.current.active = false);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    if (++frames.current === 2) onFirstFrame(); // frame 1 compiles shaders
    const idle = reducedMotion ? 0 : 0.45; // radians per second
    drag.current.velocity *= Math.exp(-dt * 2.5);
    g.rotation.y += (idle + drag.current.velocity) * dt;
    // Lean a little towards the pointer.
    const k = 1 - Math.exp(-dt * 4);
    g.rotation.x += (-state.pointer.y * 0.25 + 0.12 - g.rotation.x) * k;
    g.rotation.z += (state.pointer.x * -0.08 - g.rotation.z) * k;
  });

  const milk = (
    <meshPhysicalMaterial color="#ffffff" roughness={0.25} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={1.4} />
  );

  return (
    <group ref={group} scale={SCALE}>
      <mesh geometry={geo.body}>
        <MeshTransmissionMaterial
          background={env ?? undefined}
          backside
          backsideThickness={0.4}
          samples={10}
          resolution={768}
          transmission={1}
          thickness={1.1}
          roughness={0.03}
          ior={1.5}
          chromaticAberration={1}
          anisotropicBlur={0.1}
          distortion={0.08}
          distortionScale={0.3}
          temporalDistortion={0.03}
          color="#3a5cff"
          attenuationColor="#1530ff"
          attenuationDistance={0.5}
          // A faint glow of its own keeps the glass cobalt even where there is
          // little behind it to refract.
          emissive="#1838ff"
          emissiveIntensity={0.28}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>
      <mesh geometry={geo.band}>{milk}</mesh>
      <mesh geometry={geo.nose}>{milk}</mesh>
      <mesh geometry={geo.eyes}>{milk}</mesh>
      <mesh geometry={geo.pupils}>
        <meshPhysicalMaterial color="#14172a" roughness={0.08} clearcoat={1} metalness={0.1} />
      </mesh>
    </group>
  );
}

/** Soft area lights for reflections and for the glass to refract. */
function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={["#000000"]} />
      {/* Key lights: white strips that become the bright streaks on the glass. */}
      <Lightformer form="rect" intensity={3} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 0.8, 1]} />
      <Lightformer form="rect" intensity={4} position={[-4, 1, 3]} rotation-y={Math.PI / 3} scale={[1, 6, 1]} />
      <Lightformer form="rect" intensity={4} position={[4, -1, 3]} rotation-y={-Math.PI / 3} scale={[1, 6, 1]} />
      <Lightformer form="rect" intensity={2} position={[0, 0, 6]} scale={[6, 3, 1]} />
      {/* Accents: thin coloured strips that the colour splitting turns into fringes. */}
      <Lightformer form="rect" intensity={3} position={[-5, -2, -1]} rotation-y={Math.PI / 2} scale={[4, 0.4, 1]} color="#38d0ff" />
      <Lightformer form="rect" intensity={3} position={[5, 2, -1]} rotation-y={-Math.PI / 2} scale={[4, 0.4, 1]} color="#ff52c8" />
      {/* Behind: a blue glow the head refracts. */}
      <Lightformer form="ring" intensity={3} position={[0, 0, -6]} scale={5} color="#2b4cff" />
    </Environment>
  );
}

export default function GlassLogo({ className }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Stop rendering while scrolled out of view, and honour reduced motion.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    io.observe(el);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => {
      io.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div ref={container} className={cn("relative", className)} style={{ touchAction: "pan-y" }}>
      {/* Shader compilation can take a moment: show the flat logo until the first frame. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 grid place-items-center transition-opacity duration-700",
          ready && "opacity-0",
        )}
      >
        <LogoMark className="size-24 opacity-60" />
      </div>
      <Canvas
        className={cn("transition-opacity duration-700", ready ? "opacity-100" : "opacity-0")}
        frameloop={visible ? "always" : "never"}
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5.2], fov: 32 }}
        gl={{ alpha: true, antialias: true }}
        aria-label="Spinning 3D Godot logo in blue glass. Drag to spin it."
        role="img"
      >
        <Studio />
        <Logo reducedMotion={reducedMotion} onFirstFrame={() => setReady(true)} />
      </Canvas>
    </div>
  );
}
