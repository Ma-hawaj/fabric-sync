import { cn } from '@/lib/utils'

function SewingMachineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* base/platform */}
      <path d="M4 38h44a2 2 0 0 0 2-2v-2H8a4 4 0 0 1-4-4Z" />
      {/* upright body + arm */}
      <path d="M46 34V10a4 4 0 0 0-4-4H30a2 2 0 0 0-2 2v2" />
      <path d="M22 12h-6a4 4 0 0 0-4 4v4" />
      {/* thread spool */}
      <circle cx="42" cy="8" r="3" />
      {/* needle bar, bobbing up and down */}
      <g
        className="animate-sewing-needle"
        style={{ transformBox: 'fill-box', transformOrigin: 'top' }}
      >
        <rect x="19" y="16" width="4" height="6" rx="1" />
        <line x1="21" y1="22" x2="21" y2="32" />
      </g>
      {/* fabric line, stitches trailing behind the needle */}
      <line x1="4" y1="34" x2="58" y2="34" opacity="0.35" />
      <line
        x1="4"
        y1="34"
        x2="58"
        y2="34"
        strokeDasharray="3 5"
        className="animate-sewing-stitch"
      />
    </svg>
  )
}

function LoadingIndicator({
  label,
  className,
  ...props
}: React.ComponentProps<'div'> & { label?: string }) {
  return (
    <div
      data-slot="loading-indicator"
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground',
        className,
      )}
      {...props}
    >
      <SewingMachineIcon className="h-10 w-14" />
      {label && <p>{label}</p>}
    </div>
  )
}

export { LoadingIndicator }
