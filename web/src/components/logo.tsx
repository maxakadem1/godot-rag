import { cn } from "@/lib/utils";

/** Stand-in mark until the three.js glass Godot logo replaces it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block rounded-[28%] bg-[radial-gradient(circle_at_30%_25%,#8fc3ff_0%,#2f6fd6_35%,#0b2a7a_75%,#06123a_100%)] shadow-[inset_0_1px_2px_rgb(255_255_255/0.5),0_0_24px_rgb(47_111_214/0.35)]",
        className,
      )}
    />
  );
}
