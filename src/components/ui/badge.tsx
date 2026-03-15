import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
  {
    variants: {
      variant: {
        slate: 'bg-slate-100 text-slate-700',
        blue: 'bg-sky-100 text-sky-700',
        amber: 'bg-amber-100 text-amber-700',
        orange: 'bg-orange-100 text-orange-700',
        green: 'bg-emerald-100 text-emerald-700',
        red: 'bg-rose-100 text-rose-700',
      },
    },
    defaultVariants: {
      variant: 'slate',
    },
  },
)

export function Badge({
  className,
  variant,
  children,
}: React.PropsWithChildren<VariantProps<typeof badgeVariants> & { className?: string }>) {
  return <span className={cn(badgeVariants({ variant }), className)}>{children}</span>
}
