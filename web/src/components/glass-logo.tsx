"use client";

/**
 * The Godot logo as a real 3D object in blue glass that spins. The head is a single
 * rounded glass solid with the eyes, nose and mouth cut through it as holes (see
 * glass-logo-geometry.ts for how it is shaped).
 *
 * The glass look: MeshTransmissionMaterial renders the scene behind the object into a
 * texture and samples it through the surface, bending it (ior), splitting colours
 * (chromaticAberration) and tinting it (attenuation). On a black page there would be
 * nothing to bend, so the refraction pass uses a studio of bright strips of light
 * (the environment) as its background, while the page itself stays black.
 */
import { Environment, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { LogoMark } from "./logo";
import { buildGlassLogoGeometry } from "@/lib/glass-logo-geometry";
import { cn } from "@/lib/utils";

function Logo({ reducedMotion, onFirstFrame }: { reducedMotion: boolean; onFirstFrame: () => void }) {
  const geometry = useMemo(() => buildGlassLogoGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
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

  return (
    <group ref={group} scale={1.08}>
      <mesh geometry={geometry}>
        <MeshTransmissionMaterial
          background={env ?? undefined}
          backside
          backsideThickness={0.6}
          samples={10}
          resolution={1024}
          transmission={1}
          thickness={1.2}
          roughness={0}
          ior={1.5}
          chromaticAberration={0.6}
          anisotropicBlur={0.05}
          distortion={0}
          color="#ffffff"
          attenuationColor="#1f3cff"
          attenuationDistance={0.3}
          clearcoat={1}
          clearcoatRoughness={0}
          specularIntensity={1}
          envMapIntensity={1.2}
        />
      </mesh>
    </group>
  );
}

/** Soft area lights for reflections and for the glass to refract. */
function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      {/* A dark room, so the glass has deep shadows to set off its highlights. */}
      <color attach="background" args={["#000004"]} />
      {/* Key lights: thin white strips that become the crisp streaks on the glass. */}
      <Lightformer form="rect" intensity={6} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 0.5, 1]} />
      <Lightformer form="rect" intensity={6} position={[-4, 1, 3]} rotation-y={Math.PI / 3} scale={[0.5, 8, 1]} />
      <Lightformer form="rect" intensity={5} position={[4, -1, 3]} rotation-y={-Math.PI / 3} scale={[0.4, 8, 1]} />
      <Lightformer form="rect" intensity={3} position={[0, -5, 1]} rotation-x={-Math.PI / 2} scale={[8, 0.3, 1]} />
      {/* Accents: thin coloured strips that the colour splitting turns into fringes. */}
      <Lightformer form="rect" intensity={2} position={[-5, -2, -1]} rotation-y={Math.PI / 2} scale={[4, 0.25, 1]} color="#3ee0ff" />
      <Lightformer form="rect" intensity={1.5} position={[5, 2, -1]} rotation-y={-Math.PI / 2} scale={[4, 0.25, 1]} color="#b46bff" />
      {/* Behind: patches of blue glow that parts of the head refract. */}
      <Lightformer form="circle" intensity={2.2} position={[1.5, 1, -6]} scale={4} color="#2b45ff" />
      <Lightformer form="rect" intensity={1.5} position={[-3, -2, -5]} scale={[6, 1, 1]} color="#2233ff" />
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
