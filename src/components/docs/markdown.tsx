import Link from "next/link";
import type { ComponentProps, JSX } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { docHref } from "@/lib/docs";
import { cn } from "@/lib/utils";

type Tag = keyof JSX.IntrinsicElements;

/** A markdown element rendered as `tag` with the app's classes (minus react-markdown's `node` prop). */
function styled<T extends Tag>(tag: T, className: string) {
  const Element = tag as React.ElementType;
  return function Styled({ node, ...props }: ComponentProps<T> & ExtraProps) {
    void node;
    return <Element {...props} className={cn(className, (props as { className?: string }).className)} />;
  };
}

const linkClass = "font-medium text-primary underline underline-offset-4";

/** Heading anchors share GitHub's slugs (rehype-slug), so `#docker--postgres` links keep working. */
const components: Components = {
  h1: styled("h1", "font-heading text-3xl font-bold tracking-tight sm:text-4xl"),
  h2: styled("h2", "mt-6 scroll-mt-20 border-b pb-2 font-heading text-2xl font-semibold tracking-tight"),
  h3: styled("h3", "mt-4 scroll-mt-20 font-heading text-xl font-semibold"),
  h4: styled("h4", "mt-2 scroll-mt-20 font-heading text-lg font-semibold"),
  p: styled("p", "leading-7"),
  a: function DocLink({ node, href = "", ...props }) {
    void node;
    const to = docHref(href);
    return to.startsWith("/") ? (
      <Link href={to} className={linkClass} {...props} />
    ) : (
      <a href={to} className={linkClass} {...props} />
    );
  },
  ul: styled("ul", "ml-6 list-disc space-y-1 [&_ul]:mt-1"),
  ol: styled("ol", "ml-6 list-decimal space-y-1 [&_ol]:mt-1"),
  li: styled("li", "leading-7"),
  blockquote: styled("blockquote", "border-l-4 pl-4 text-muted-foreground [&>p]:leading-7"),
  hr: styled("hr", "my-2"),
  table: function Table({ node, ...props }) {
    void node;
    return (
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full border-collapse text-sm" {...props} />
      </div>
    );
  },
  th: styled("th", "border-b px-3 py-2 text-left align-bottom font-semibold"),
  td: styled("td", "border-b px-3 py-2 align-top"),
  pre: styled(
    "pre",
    "overflow-x-auto rounded-xl bg-muted p-4 font-mono text-sm leading-6 [&>code]:bg-transparent [&>code]:p-0",
  ),
  code: styled("code", "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] break-words"),
};

/** Renders one of the repo's markdown docs (GitHub-flavoured) with the app's styles. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
