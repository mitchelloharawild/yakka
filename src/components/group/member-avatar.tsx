import { cn } from "@/lib/utils";
import { initials } from "./time";

/** Colours offered in the member colour picker (also the automatic palette). */
export const MEMBER_COLOURS = [
  "#e11d48",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#16a34a",
  "#0d9488",
  "#0284c7",
  "#2563eb",
  "#7c3aed",
  "#c026d3",
  "#db2777",
  "#57534e",
] as const;

/** Deterministic palette colour for a member without one. */
export function autoColour(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MEMBER_COLOURS[h % MEMBER_COLOURS.length];
}

/** The colour to show for a member. */
export function memberColour(m: { id: string; colour?: string | null }): string {
  return m.colour ?? autoColour(m.id);
}

const sizes = {
  xs: "size-5 text-[0.6rem]",
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-base",
} as const;

/** Round coloured badge with a member's initials. `member` null = automation/unknown. */
export function MemberAvatar({
  member,
  size = "sm",
  className,
}: {
  member: { id: string; name: string; colour?: string | null } | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
        member ? "" : "bg-muted text-muted-foreground",
        sizes[size],
        className,
      )}
      style={member ? { backgroundColor: memberColour(member) } : undefined}
    >
      {member ? initials(member.name) : "⚙"}
    </span>
  );
}
