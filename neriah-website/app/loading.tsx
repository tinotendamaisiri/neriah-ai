export default function Loading() {
  return (
    <div className="min-h-screen bg-off-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-1.5" aria-label="Loading" role="status">
          {[0, 150, 300].map(d => (
            <div
              key={d}
              className="w-2 h-2 bg-teal rounded-full animate-dot-pulse"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  )
}
