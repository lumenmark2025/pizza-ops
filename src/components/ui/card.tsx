import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/60 bg-white/85 shadow-panel backdrop-blur',
        className,
      )}
      {...props}
    />
  )
}
