// Stroke icons of the shell (docs/design/10_visual.md, section 6). Decorative: each sits next to its words.
const Svg = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const HomeIcon = () => <Svg d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z" />;
export const SearchIcon = () => <Svg d="M11 4 a7 7 0 1 0 0.01 0 Z M16.5 16.5 L21 21" />;
export const PlusIcon = () => <Svg d="M12 5 V19 M5 12 H19" />;
export const ChatIcon = () => <Svg d="M4 5 H20 V16 H10 L5 20 V16 H4 Z" />;
export const UserIcon = () => <Svg d="M12 4 a4 4 0 1 0 0.01 0 Z M4 21 c1 -5 15 -5 16 0" />;
export const BellIcon = () => <Svg d="M6 16 V11 a6 6 0 0 1 12 0 V16 l2 2 H4 Z M10 20 a2 2 0 0 0 4 0" />;
export const OrdersIcon = () => <Svg d="M4 8 L12 4 L20 8 V17 L12 21 L4 17 Z M4 8 L12 12 L20 8 M12 12 V21" />;

/** The verified mark: a scalloped seal with a tick, drawn once and sized by its parent. */
export const Tick = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path
      d="M22.96 12.00 L22.84 12.71 L22.49 13.38 L22.00 13.99 L21.48 14.54 L21.03 15.07 L20.72 15.61 L20.55 16.22 L20.50 16.91 L20.48 17.67 L20.40 18.44 L20.17 19.16 L19.75 19.75 L19.16 20.17 L18.44 20.40 L17.67 20.48 L16.91 20.50 L16.22 20.55 L15.61 20.72 L15.07 21.03 L14.54 21.48 L13.99 22.00 L13.38 22.49 L12.71 22.84 L12.00 22.96 L11.29 22.84 L10.62 22.49 L10.01 22.00 L9.46 21.48 L8.93 21.03 L8.39 20.72 L7.78 20.55 L7.09 20.50 L6.33 20.48 L5.56 20.40 L4.84 20.17 L4.25 19.75 L3.83 19.16 L3.60 18.44 L3.52 17.67 L3.50 16.91 L3.45 16.22 L3.28 15.61 L2.97 15.07 L2.52 14.54 L2.00 13.99 L1.51 13.38 L1.16 12.71 L1.04 12.00 L1.16 11.29 L1.51 10.62 L2.00 10.01 L2.52 9.46 L2.97 8.93 L3.28 8.39 L3.45 7.78 L3.50 7.09 L3.52 6.33 L3.60 5.56 L3.83 4.84 L4.25 4.25 L4.84 3.83 L5.56 3.60 L6.33 3.52 L7.09 3.50 L7.78 3.45 L8.39 3.28 L8.93 2.97 L9.46 2.52 L10.01 2.00 L10.62 1.51 L11.29 1.16 L12.00 1.04 L12.71 1.16 L13.38 1.51 L13.99 2.00 L14.54 2.52 L15.07 2.97 L15.61 3.28 L16.22 3.45 L16.91 3.50 L17.67 3.52 L18.44 3.60 L19.16 3.83 L19.75 4.25 L20.17 4.84 L20.40 5.56 L20.48 6.33 L20.50 7.09 L20.55 7.78 L20.72 8.39 L21.03 8.93 L21.48 9.46 L22.00 10.01 L22.49 10.62 L22.84 11.29 Z"
      fill="currentColor"
      strokeLinejoin="round"
    />
    <path d="M7.6 12.4 l3.2 3.2 l5.8 -6.4" fill="none" stroke="var(--tb-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
