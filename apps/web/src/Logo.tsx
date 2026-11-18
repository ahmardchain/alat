/** The Alat mark: a chat bubble whose tail is the bit of a key. */
export function Mark({ size = 28, fill = "none" }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M9 4h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H14v4h-3v-2H8v-2h3v-2h-2a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6z"
        fill={fill}
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
