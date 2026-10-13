"use client";

/**
 * Chrome for every /groups/[groupId] page: group name, current identity
 * with a switcher, section nav, the "Who are you?" prompt, `?as=` device
 * transfer and recent-groups bookkeeping.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  ChevronDownIcon,
  ListChecksIcon,
  NfcIcon,
  PlugIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { adoptTagIdentity, setIdentity, touchGroup, useHydrated, useIdentity } from "@/lib/client/local-groups";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { useActor, useErrorMessage, useGroup, type GroupMember } from "./group-context";
import { IdentityDialog } from "@/components/identity-picker";
import { MemberAvatar } from "./member-avatar";

interface IdentityApi {
  /** The current (active) member, or null. */
  me: GroupMember | null;
  /** Open the picker; resolves with the chosen member id, or null if dismissed. */
  requestIdentity: () => Promise<string | null>;
  /** Open the picker to switch identity. */
  openPicker: () => void;
}

const IdentityContext = createContext<IdentityApi | null>(null);

/** Current identity and the picker, inside the group shell. */
export function useGroupIdentity(): IdentityApi {
  const v = useContext(IdentityContext);
  if (!v) throw new Error("useGroupIdentity() must be used inside <GroupShell>");
  return v;
}

const sections = [
  { key: "chores", href: "", icon: ListChecksIcon },
  { key: "activity", href: "/activity", icon: ActivityIcon },
  { key: "members", href: "/members", icon: UsersIcon },
  { key: "tags", href: "/tags", icon: NfcIcon },
  { key: "integrations", href: "/integrations", icon: PlugIcon },
  { key: "settings", href: "/settings", icon: SettingsIcon },
] as const;

export function GroupShell({ children }: { children: React.ReactNode }) {
  const group = useGroup();
  const groupId = group.id;
  const t = useTranslations("group");
  const trpc = useTRPC();
  const qc = useQueryClient();
  const actor = useActor();
  const errorMessage = useErrorMessage();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const { memberId, setMemberId } = useIdentity(groupId);
  const me = group.members.find((m) => m.id === memberId && !m.archivedAt) ?? null;

  const [explicitOpen, setExplicitOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const resolver = useRef<((id: string | null) => void) | null>(null);

  // Remember this group (and its current name) on this device.
  useEffect(() => {
    touchGroup({ id: groupId, name: group.name });
  }, [groupId, group.name]);

  // Hand-over from a tag: someone who picked "who are you?" on a tag page
  // (which never reveals the group id) is the same person here.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("as")) return;
    adoptTagIdentity(groupId, group.name, (id) => group.members.some((m) => m.id === id && !m.archivedAt));
    // Only on first mount of this group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Device transfer: /groups/{id}?as={memberId} sets the identity, then the
  // parameter is stripped so the link isn't bookmarked or shared with it.
  const hasAsParam = hydrated && new URLSearchParams(window.location.search).has("as");
  useEffect(() => {
    const url = new URL(window.location.href);
    const as = url.searchParams.get("as");
    if (!as) return;
    url.searchParams.delete("as");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const m = group.members.find((x) => x.id === as && !x.archivedAt);
    if (m) {
      setIdentity(groupId, m.id, group.name);
      toast.success(t("identity.nowActingAs", { name: m.name }));
    } else {
      toast.error(t("identity.transferUnknown"));
    }
    // Only on first mount of this group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const autoOpen = hydrated && !me && !dismissed && !hasAsParam;
  const open = explicitOpen || autoOpen;

  const close = useCallback((id: string | null) => {
    setExplicitOpen(false);
    setDismissed(true);
    resolver.current?.(id);
    resolver.current = null;
  }, []);

  const requestIdentity = useCallback(() => {
    resolver.current?.(null);
    setExplicitOpen(true);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const openPicker = useCallback(() => setExplicitOpen(true), []);

  const addMember = useMutation(
    trpc.groups.members.add.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: trpc.groups.get.queryKey({ groupId }) }),
      onError: (e) => toast.error(errorMessage(e)),
    }),
  );

  function pick(id: string) {
    setMemberId(id, group.name);
    const m = group.members.find((x) => x.id === id);
    if (m && id !== memberId) toast.success(t("identity.youAre", { name: m.name }));
    close(id);
  }

  async function create(name: string) {
    const m = await addMember.mutateAsync({ groupId, name, actor: actor() });
    await qc.invalidateQueries({ queryKey: trpc.groups.get.queryKey({ groupId }) });
    setMemberId(m.id, group.name);
    toast.success(t("identity.youAre", { name: m.name }));
    close(m.id);
  }

  const base = `/groups/${groupId}`;

  return (
    <IdentityContext.Provider value={{ me, requestIdentity, openPicker }}>
      <div className="sticky top-14 z-30 -mx-4 -mt-6 mb-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2 pt-3 pb-2">
          <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-semibold tracking-tight">{group.name}</h1>
          <button
            type="button"
            onClick={openPicker}
            className="flex h-9 max-w-[45%] items-center gap-2 rounded-full border bg-card py-1 pr-2.5 pl-1 text-sm font-medium transition-colors hover:bg-muted"
            aria-label={t("identity.switch")}
          >
            {me ? (
              <MemberAvatar member={me} size="sm" />
            ) : (
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted">
                <UserRoundIcon className="size-4 text-muted-foreground" />
              </span>
            )}
            <span className="truncate" suppressHydrationWarning>
              {me ? me.name : hydrated ? t("identity.notSet") : ""}
            </span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
        <GroupNav base={base} pathname={pathname} label={t("nav.label")} itemLabel={(key) => t(`nav.${key}`)} />
      </div>
      {children}
      <IdentityDialog
        open={open}
        onOpenChange={(o) => (o ? setExplicitOpen(true) : close(null))}
        members={group.members}
        currentMemberId={me?.id}
        onPick={pick}
        onCreate={create}
      />
    </IdentityContext.Provider>
  );
}

/**
 * Section tabs. On phones the inactive tabs are icon-only (with an
 * accessible name and tooltip) so all six fit at 360-390 px; from `sm` up
 * every tab has its label. If they still overflow (very narrow screens or
 * large text), the row scrolls, fades at the edge that has more, and keeps
 * the active tab in view.
 */
function GroupNav({
  base,
  pathname,
  label,
  itemLabel,
}: {
  base: string;
  pathname: string;
  label: string;
  itemLabel: (key: (typeof sections)[number]["key"]) => string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setFade({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pathname, update]);

  return (
    <div className="relative -mx-4">
      <nav
        ref={ref}
        aria-label={label}
        onScroll={update}
        className="flex gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] sm:gap-1 sm:px-4 [&::-webkit-scrollbar]:hidden"
      >
        {sections.map(({ key, href, icon: Icon }) => {
          const to = base + href;
          const active = href === "" ? pathname === base : pathname === to || pathname.startsWith(to + "/");
          const name = itemLabel(key);
          return (
            <Link
              key={key}
              href={to}
              aria-current={active ? "page" : undefined}
              aria-label={name}
              title={name}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 pt-1 pb-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-2.5",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className={cn(!active && "sr-only sm:not-sr-only")}>{name}</span>
            </Link>
          );
        })}
      </nav>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent transition-opacity",
          fade.left ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent transition-opacity",
          fade.right ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
