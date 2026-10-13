/**
 * Huge tick shown after a tap-to-complete. The tick is fully drawn at rest
 * (and with reduced motion); the draw-in animation only starts it part-way,
 * so it is never invisible, even on the first frame or in a screenshot. The
 * styles live in globals.css (`.yakka-check-path`).
 */
export function BigCheck({ muted = false }: { muted?: boolean }) {
  return (
    <div
      className={`flex size-40 items-center justify-center rounded-full motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-300 ${
        muted
          ? "bg-muted text-muted-foreground"
          : "bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 dark:bg-emerald-500 dark:text-emerald-950"
      }`}
    >
      <svg viewBox="0 0 52 52" className="size-24" aria-hidden>
        <path
          d="M14 27 l8 8 l16 -18"
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="yakka-check-path"
        />
      </svg>
    </div>
  );
}
