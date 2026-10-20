// Backbone Design System — vendored component barrel.
// Named re-exports of the components, hooks, and prop types the app uses,
// grouped by source family. Pruned from the full design-system .d.ts surface;
// re-vendor a component from the kit when a screen needs it.

// ── icon ──────────────────────────────────────────────────────────────────
export { Icon, iconNames } from './Icon';
export type { IconName, IconProps } from './Icon';

// ── actions ─────────────────────────────────────────────────────────────────
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps } from './SegmentedControl';

// ── data ──────────────────────────────────────────────────────────────────
export { DataTable } from './DataTable';
export type { Column, DataTableProps } from './DataTable';
export { KpiCard, KpiRow } from './KpiCard';
export type { KpiCardProps, KpiRowProps } from './KpiCard';
export { Panel, Inset, PageBody } from './Panel';
export type { PanelProps, InsetProps, PageBodyProps } from './Panel';

// ── feedback ────────────────────────────────────────────────────────────────
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { InlineMessage } from './InlineMessage';
export type { InlineMessageProps } from './InlineMessage';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { Toast, ToastStack } from './Toast';
export type { ToastProps, ToastStackProps } from './Toast';

// ── forms ──────────────────────────────────────────────────────────────────
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { SearchInput } from './SearchInput';
export type { SearchInputProps } from './SearchInput';
export { SelectField } from './SelectField';
export type { SelectFieldProps } from './SelectField';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { Field, TextField, useFieldIds } from './TextField';
export type { FieldProps, TextFieldProps } from './TextField';
export { TextareaField } from './TextareaField';
export type { TextareaFieldProps } from './TextareaField';

// ── navigation ──────────────────────────────────────────────────────────────
export { SidebarNav } from './SidebarNav';
export type { NavItem, SidebarNavProps } from './SidebarNav';
export { Tabs, TabPanel } from './Tabs';
export type { TabItem, TabsProps, TabPanelProps } from './Tabs';

// ── overlays ────────────────────────────────────────────────────────────────
export { Modal, CloseButton, useOverlay, useOverlayIds } from './Modal';
export type { ModalProps, CloseButtonProps } from './Modal';

// ── status ──────────────────────────────────────────────────────────────────
export { Badge } from './Badge';
export type { BadgeProps } from './Badge';
export { Counter } from './Counter';
export type { CounterProps } from './Counter';
export { StatusDot } from './StatusDot';
export type { StatusDotProps } from './StatusDot';
