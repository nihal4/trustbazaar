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
