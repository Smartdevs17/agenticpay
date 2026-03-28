import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"

const breadcrumbVariants = cva("flex items-center gap-1.5")

interface BreadcrumbProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof breadcrumbVariants> {}

const Breadcrumb = React.forwardRef<HTMLDivElement, BreadcrumbProps>(
  ({ className, ...props }, ref) => (
    <nav
      ref={ref}
      aria-label="breadcrumb"
      className={cn(breadcrumbVariants(), className)}
      {...props}
    />
  )
)
Breadcrumb.displayName = "Breadcrumb"

interface BreadcrumbListProps extends React.HTMLAttributes<HTMLOListElement> {}

const BreadcrumbList = React.forwardRef<HTMLOListElement, BreadcrumbListProps>(
  ({ className, ...props }, ref) => (
    <ol
      ref={ref}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      {...props}
    />
  )
)
BreadcrumbList.displayName = "BreadcrumbList"

interface BreadcrumbItemProps extends React.HTMLAttributes<HTMLLIElement> {}

const BreadcrumbItem = React.forwardRef<HTMLLIElement, BreadcrumbItemProps>(
  ({ className, ...props }, ref) => (
    <li
      ref={ref}
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  )
)
BreadcrumbItem.displayName = "BreadcrumbItem"

interface BreadcrumbLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  asChild?: boolean
  href: string
}

const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
  ({ className, href, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : Link
    
    return (
      <Comp
        ref={ref}
        href={href}
        className={cn(
          "text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors cursor-pointer",
          className
        )}
        {...props}
      />
    )
  }
)
BreadcrumbLink.displayName = "BreadcrumbLink"

interface BreadcrumbPageProps
  extends React.HTMLAttributes<HTMLSpanElement> {}

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, BreadcrumbPageProps>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      role="doc-biblioentry"
      aria-current="page"
      className={cn(
        "text-sm font-medium text-gray-900",
        className
      )}
      {...props}
    />
  )
)
BreadcrumbPage.displayName = "BreadcrumbPage"

interface BreadcrumbSeparatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
}

const BreadcrumbSeparator = ({ className, icon, ...props }: BreadcrumbSeparatorProps) =>
  icon ? (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn("text-gray-400", className)}
      {...props}
    >
      {icon}
    </div>
  ) : (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn("text-gray-400", className)}
      {...props}
    >
      <ChevronRight className="h-4 w-4" />
    </div>
  )
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
}
