// Small, hand-drawn icon set (inline SVG, no icon-library dependency) used
// across the dashboard for consistent iconography. Each icon is a simple
// 20x20 stroke glyph that inherits color via `currentColor`, sized with the
// `className` prop like any other element.

const base = (children, props) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {children}
  </svg>
);

export const IconMail = (props) => base(
  <>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="M3.5 6l6.5 5 6.5-5" />
  </>,
  props
);

export const IconClock = (props) => base(
  <>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 6v4.2l2.8 1.8" />
  </>,
  props
);

export const IconGrid = (props) => base(
  <>
    <rect x="2.75" y="2.75" width="5.5" height="5.5" rx="1.25" />
    <rect x="11.75" y="2.75" width="5.5" height="5.5" rx="1.25" />
    <rect x="2.75" y="11.75" width="5.5" height="5.5" rx="1.25" />
    <rect x="11.75" y="11.75" width="5.5" height="5.5" rx="1.25" />
  </>,
  props
);

export const IconCheckCircle = (props) => base(
  <>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M6.8 10.2l2.1 2.1 4.3-4.6" />
  </>,
  props
);

export const IconPause = (props) => base(
  <>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M8.2 7.3v5.4M11.8 7.3v5.4" />
  </>,
  props
);

export const IconPencil = (props) => base(
  <path d="M12.9 3.6l3.5 3.5-9.6 9.6-4.1.6.6-4.1 9.6-9.6z" />,
  props
);

export const IconChat = (props) => base(
  <path d="M3 4.5h14a1 1 0 011 1V13a1 1 0 01-1 1H8l-3.8 3V14H3a1 1 0 01-1-1V5.5a1 1 0 011-1z" />,
  props
);

export const IconSparkle = (props) => base(
  <path d="M10 3l1.4 4.3L15.7 8l-4.3 1.4L10 13.7l-1.4-4.3L4.3 8l4.3-1.4L10 3z" />,
  props
);

export const IconUserCircle = (props) => base(
  <>
    <circle cx="10" cy="10" r="7.25" />
    <circle cx="10" cy="8.3" r="2.3" />
    <path d="M4.7 15.4a5.6 5.6 0 0110.6 0" />
  </>,
  props
);

export const IconPin = (props) => base(
  <>
    <path d="M10 17.5s5.5-5 5.5-9A5.5 5.5 0 004.5 8.5c0 4 5.5 9 5.5 9z" />
    <circle cx="10" cy="8.5" r="2" />
  </>,
  props
);

export const IconArrowRight = (props) => base(
  <path d="M4 10h11.5M11.5 5.5L16 10l-4.5 4.5" />,
  props
);

export const IconThumbUp = (props) => base(
  <path d="M7 8.5v8h7.2a1.5 1.5 0 001.45-1.13l1.2-4.5A1.5 1.5 0 0015.45 9H12l.6-3.2a1.4 1.4 0 00-2.5-1.1L7 8.5z" />,
  props
);

export const IconThumbDown = (props) => base(
  <path d="M13 11.5v-8H5.8a1.5 1.5 0 00-1.45 1.13l-1.2 4.5A1.5 1.5 0 004.55 11H8l-.6 3.2a1.4 1.4 0 002.5 1.1L13 11.5z" />,
  props
);
