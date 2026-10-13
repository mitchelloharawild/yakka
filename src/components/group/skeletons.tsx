import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for the group header + nav while the group loads. */
export function GroupShellSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div aria-busy>
      <div className="-mx-4 -mt-6 mb-4 border-b px-4">
        <div className="flex items-center gap-2 pt-3 pb-2">
          <Skeleton className="h-7 w-44" />
          <div className="flex-1" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <div className="flex gap-3 pt-1 pb-2">
          {[64, 72, 76, 48, 92, 68].map((w, i) => (
            <Skeleton key={i} className="h-5" style={{ width: w }} />
          ))}
        </div>
      </div>
      {children ?? <ListSkeleton />}
    </div>
  );
}

/** Placeholder for a list of cards. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border p-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="size-12 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a settings-style form. */
export function FormSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-3/4" />
        </div>
      ))}
    </div>
  );
}
