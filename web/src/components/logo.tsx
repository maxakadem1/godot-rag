import { GODOT_LOGO as L } from "@/lib/godot-logo";
import { cn } from "@/lib/utils";

/** Flat Godot logo: small marks, and the placeholder while the 3D one loads. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="40 40 944 944" aria-hidden className={cn("inline-block shrink-0", className)}>
      <path d={L.band} fill="#fff" />
      <path d={L.body} fill={L.blue} />
      <path d={L.nose} fill="#fff" />
      {L.eyes.map((e) => (
        <circle key={e.cx} cx={e.cx} cy={e.cy} r={e.r} fill="#fff" />
      ))}
      {L.pupils.map((p) => (
        <circle key={p.cx} cx={p.cx} cy={p.cy} r={p.r} fill="#414042" />
      ))}
    </svg>
  );
}
