// The primitives (U11-04): every kind of component exists once, here, and a page only chooses its variant. src/shared/ui imports nothing from the api, the router, react-query or the
// features (dependency-cruiser: shared-ui-is-presentational); the words and steps of a role come in as props from the page's view model.
export { Avatar, initials, type AvatarSize } from './Avatar';
export { Button, IconButton, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Checkbox, Radio } from './Choice';
export { Field, FieldMessage, Input, Select, TextField, Textarea, type ControlLook, type ControlProps } from './Field';
export { Notice, type NoticeTone } from './Notice';
export { Calendar, isValidDate, type CalendarLabels } from './Calendar';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { FactList, type Fact } from './FactList';
export { Card, Panel, Section, type PanelVariant } from './Panel';
export { Popup, PopupActions, type PopupProps } from './Popup';
export { Stepper, type StepperStep, type StepState } from './Stepper';
export { Table, type TableColumn } from './Table';
export { Tab, Tabs } from './Tabs';
export { Count, Tag, type TagTone } from './Tag';
export { cx } from './cx';
