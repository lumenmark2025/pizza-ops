import { Flame } from 'lucide-react'
import { cn } from '../lib/utils'

export function ChilliRating({
  rating,
  className,
  showNoneLabel = false,
}: {
  rating: number
  className?: string
  showNoneLabel?: boolean
}) {
  const normalizedRating = Math.max(0, Math.min(3, Math.trunc(rating)))

  if (normalizedRating <= 0) {
    return showNoneLabel ? <span className={cn('text-xs font-medium text-slate-500', className)}>None</span> : null
  }

  return (
    <span className={cn('inline-flex items-center gap-0.5 text-rose-600', className)} aria-label={`${normalizedRating} chilli`}>
      {Array.from({ length: normalizedRating }, (_, index) => (
        <Flame key={index} className="h-3.5 w-3.5 fill-current" />
      ))}
    </span>
  )
}
