// The primitives (U11-04): every kind of component exists once, here, and a page only chooses its variant. src/shared/ui imports nothing from the api, the router, react-query or the
// features (dependency-cruiser: shared-ui-is-presentational); the words and steps of a role come in as props from the page's view model.
export { Avatar, initials, type AvatarSize } from './Avatar';
export { Button, IconButton, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Checkbox, Radio } from './Choice';
export { Field, Input, Select, TextField, Textarea, type ControlProps } from './Field';
export { Notice, type NoticeTone } from './Notice';
export { Count, Tag, type TagTone } from './Tag';
export { cx } from './cx';
