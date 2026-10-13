/** Huge animated tick shown after a tap-to-complete. Respects reduced motion. */
export function BigCheck({ muted = false }: { muted?: boolean }) {
  return (
    <div
      className={`flex size-40 items-center justify-center rounded-full motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300 ${
        muted ? "bg-muted text-muted-foreground" : "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 dark:bg-emerald-600"
      }`}
    >
      <svg viewBox="0 0 52 52" className="size-24" aria-hidden>
        <path
          d="M14 27 l8 8 l16 -18"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="yakka-check-path"
        />
      </svg>
      <style>{`
        .yakka-check-path { stroke-dasharray: 48; stroke-dashoffset: 0; }
        @media (prefers-reduced-motion: no-preference) {
          .yakka-check-path { animation: yakka-check-draw 450ms 150ms ease-out both; }
        }
        @keyframes yakka-check-draw { from { stroke-dashoffset: 48; } to { stroke-dashoffset: 0; } }
      `}</style>
    </div>
  );
}
