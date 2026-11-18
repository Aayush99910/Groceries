/**
 * The icon set: inline SVG, stroke-based, sized in `em` so icons scale with the
 * text they sit beside, and coloured with `currentColor` so they inherit theme
 * colours automatically. No icon library, no font, no network request.
 *
 * All drawn on a 24x24 grid with round caps and joins, so they read as one family.
 */

export type IconName =
  | "list"
  | "plus"
  | "thumbUp"
  | "thumbDown"
  | "camera"
  | "trash"
  | "check"
  | "close"
  | "undo"
  | "cart"
  | "store"
  | "tag"
  | "signOut"
  | "chevronDown"
  | "sparkle"
  | "download"
  | "chevronLeft"
  | "chevronRight"
  | "user"
  | "lock"
  | "pencil"
  | "clock"
  | "search"
  | "mapPin";

type Props = {
  name: IconName;
  size?: number | string;
  /** Nudge the stroke thinner or thicker; 1.75 reads well at phone sizes. */
  weight?: number;
  className?: string;
  title?: string;
};

/** Each entry draws inside a 0 0 24 24 box. */
const PATHS: Record<IconName, React.ReactNode> = {
  // A checklist -- the shopping list.
  list: (
    <>
      <path d="M3.5 6.5 5.5 8.5 9 5" />
      <path d="M3.5 17.5 5.5 19.5 9 16" />
      <path d="M12.5 6.75H21" />
      <path d="M12.5 17.75H21" />
    </>
  ),

  plus: (
    <>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </>
  ),

  // Base of the hand, then the palm and thumb as one outline.
  thumbUp: (
    <>
      <rect x="2.5" y="10" width="4.6" height="11" rx="1.3" />
      <path d="M7.1 10.6h1.3a2 2 0 0 0 1.83-1.18l2.32-5.15a2.05 2.05 0 0 1 3.9 1.15L15.7 10h3.4a2.25 2.25 0 0 1 2.16 2.88l-1.9 6.5A2.25 2.25 0 0 1 17.2 21H7.1z" />
    </>
  ),

  // Same drawing, flipped -- guarantees the pair is symmetrical.
  thumbDown: (
    <g transform="translate(0,24) scale(1,-1)">
      <rect x="2.5" y="10" width="4.6" height="11" rx="1.3" />
      <path d="M7.1 10.6h1.3a2 2 0 0 0 1.83-1.18l2.32-5.15a2.05 2.05 0 0 1 3.9 1.15L15.7 10h3.4a2.25 2.25 0 0 1 2.16 2.88l-1.9 6.5A2.25 2.25 0 0 1 17.2 21H7.1z" />
    </g>
  ),

  camera: (
    <>
      <path d="M22 18.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2.9l1.6-2.4a1 1 0 0 1 .84-.45h5.32a1 1 0 0 1 .84.45L17.1 7.5H20a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13.5" r="3.6" />
    </>
  ),

  trash: (
    <>
      <path d="M3.5 6.5h17" />
      <path d="M9 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
      <path d="M18.5 6.5 17.6 19.7a1.9 1.9 0 0 1-1.9 1.8H8.3a1.9 1.9 0 0 1-1.9-1.8L5.5 6.5" />
      <path d="M10.2 11v6" />
      <path d="M13.8 11v6" />
    </>
  ),

  check: <path d="M20 6.5 9.2 17.3l-5.2-5.2" />,

  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </>
  ),

  undo: (
    <>
      <path d="M3.6 12a8.6 8.6 0 1 0 2.9-6.4" />
      <path d="M3.2 4.6v5.2h5.2" />
    </>
  ),

  cart: (
    <>
      <path d="M2 3.5h2.6l2.5 11.4a2 2 0 0 0 1.95 1.57h8.3a2 2 0 0 0 1.95-1.54L21.5 7.6H6.1" />
      <circle cx="10" cy="20" r="1.5" />
      <circle cx="17.5" cy="20" r="1.5" />
    </>
  ),

  store: (
    <>
      <path d="M3.2 9.5 5.1 4.2h13.8l1.9 5.3" />
      <path d="M4.4 9.5V20h15.2V9.5" />
      <path d="M9.4 20v-5.6h5.2V20" />
      <path d="M3.2 9.5h17.6" />
    </>
  ),

  tag: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.83 0l-7-7A2 2 0 0 1 3 12.17V5a2 2 0 0 1 2-2h7.17a2 2 0 0 1 1.42.59l7 7a2 2 0 0 1 0 2.83z" />
      <circle cx="7.7" cy="7.7" r="1.3" />
    </>
  ),

  signOut: (
    <>
      <path d="M14.5 12H4" />
      <path d="M8 8l-4 4 4 4" />
      <path d="M12.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5.5" />
    </>
  ),

  chevronDown: <path d="M6 9.5l6 6 6-6" />,

  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17.5v1.6a1.9 1.9 0 0 0 1.9 1.9h12.2a1.9 1.9 0 0 0 1.9-1.9v-1.6" />
    </>
  ),

  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),

  mapPin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),

  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,

  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.6 20c.9-3.7 3.8-5.6 7.4-5.6s6.5 1.9 7.4 5.6" />
    </>
  ),

  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),

  pencil: (
    <>
      <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 7.5l3 3" />
    </>
  ),

  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),

  sparkle: (
    <>
      <path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
};

export default function Icon({ name, size = "1.15em", weight = 1.75, className, title }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative unless given a title: screen readers should read the button's
      // label, not guess at the drawing.
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      style={{ flex: "0 0 auto" }}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
