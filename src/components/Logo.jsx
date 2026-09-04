// pickaride-Logo: grünes Badge mit Lenkrad (unten links) und Chat-Blase
// (oben rechts), daneben der Schriftzug. Für dunkle Header-Hintergründe
// (weißer Schriftzug) konzipiert. Das Icon füllt die komplette Höhe aus.
export default function Logo({ height = 40, showWordmark = true }) {
  const viewBoxWidth = showWordmark ? 660 : 120
  const width = height * (viewBoxWidth / 120)
  return (
    <svg
      height={height}
      width={width}
      viewBox={`0 0 ${viewBoxWidth} 120`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
      role="img"
      aria-label="pickaride"
    >
      <rect x="0" y="0" width="120" height="120" rx="26" fill="#2e9c72" />

      <circle cx="40" cy="82" r="26" stroke="#ffffff" strokeWidth="6" fill="none" />
      <circle cx="40" cy="82" r="8" fill="#ffffff" />
      <line x1="40" y1="82" x2="40" y2="56" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
      <line x1="40" y1="82" x2="63" y2="95" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
      <line x1="40" y1="82" x2="17" y2="95" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />

      <rect x="56" y="8" width="54" height="38" rx="16" fill="#ffffff" />
      <path d="M64,46 L64,59 L77,46 Z" fill="#ffffff" />

      {showWordmark && (
        <text x="150" y="88" fontSize="96" fontWeight="500" fill="#ffffff">pickaride</text>
      )}
    </svg>
  )
}
