import type { LucideIcon, LucideProps } from 'lucide-react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChartColumn,
  ChevronsUpDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  CircleMinus,
  CirclePlus,
  CircleX,
  CloudUpload,
  Diff,
  FolderOpen,
  Globe,
  Hourglass,
  Images,
  Inbox,
  Info,
  Copy,
  ChevronRight,
  Minus,
  MoreHorizontal,
  X,
  LogOut,
  Menu,
  MessageSquareText,
  RefreshCw,
  Search,
  Settings,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react'
import { createElement } from 'react'

/** Icon props: Lucide's, so `size`, `strokeWidth`, `className` and `aria-label` all work. */
export type IconProps = LucideProps

/** The defaults (docs/design-gaps.md §12): 16px, stroke 1.75, colour inherited, hidden from assistive tech. */
function icon(Glyph: LucideIcon, name: string) {
  function Icon(props: IconProps) {
    return createElement(Glyph, {
      size: 16,
      strokeWidth: 1.75,
      'aria-hidden': props['aria-label'] ? undefined : true,
      ...props,
    })
  }
  Icon.displayName = name
  return Icon
}

/*
 * The icons the web app uses today (Material icon -> Lucide icon). Add one here when a page needs
 * it; apps never import `lucide-react` themselves. Status is never one of these: use `StatusIcon`.
 *
 *   AddCircleOutlineOutlined       CirclePlus
 *   ArrowBack                      ArrowLeft
 *   CancelOutlined                 CircleX
 *   CheckCircleOutlineOutlined     CircleCheck
 *   CloudUploadOutlined            CloudUpload
 *   CollectionsOutlined            Images
 *   DifferenceOutlined             Diff
 *   ErrorOutlineOutlined           CircleAlert
 *   ExpandLess                     ChevronUp
 *   ExpandMore                     ChevronDown
 *   FolderOpenOutlined             FolderOpen
 *   PublicOutlined                 Globe
 *   HourglassEmpty                 Hourglass
 *   RateReviewOutlined             MessageSquareText
 *   Refresh                        RefreshCw
 *   RemoveCircleOutlineOutlined    CircleMinus
 *   ReportProblemOutlined          TriangleAlert
 *   TaskAlt                        CircleCheckBig
 *   (shell)                        Check, ChevronsUpDown, LogOut, Menu, User, Users
 *   (sidebar)                      ChartColumn, Search, Settings
 *   (components)                   ChevronRight, Copy, Inbox, Info, Minus, MoreHorizontal (the row's "…"), X
 */
export const AddCircleIcon = icon(CirclePlus, 'AddCircleIcon')
export const ArrowBackIcon = icon(ArrowLeft, 'ArrowBackIcon')
export const CheckIcon = icon(Check, 'CheckIcon')
export const CancelIcon = icon(CircleX, 'CancelIcon')
export const CheckCircleIcon = icon(CircleCheck, 'CheckCircleIcon')
export const CloudUploadIcon = icon(CloudUpload, 'CloudUploadIcon')
export const CollectionsIcon = icon(Images, 'CollectionsIcon')
export const DifferenceIcon = icon(Diff, 'DifferenceIcon')
export const ErrorIcon = icon(CircleAlert, 'ErrorIcon')
export const ChevronsUpDownIcon = icon(ChevronsUpDown, 'ChevronsUpDownIcon')
export const ExpandLessIcon = icon(ChevronUp, 'ExpandLessIcon')
export const ExpandMoreIcon = icon(ChevronDown, 'ExpandMoreIcon')
export const FolderOpenIcon = icon(FolderOpen, 'FolderOpenIcon')
export const GlobeIcon = icon(Globe, 'GlobeIcon')
export const HourglassIcon = icon(Hourglass, 'HourglassIcon')
export const ReviewIcon = icon(MessageSquareText, 'ReviewIcon')
export const RefreshIcon = icon(RefreshCw, 'RefreshIcon')
export const RemoveCircleIcon = icon(CircleMinus, 'RemoveCircleIcon')
export const WarningIcon = icon(TriangleAlert, 'WarningIcon')
export const TaskDoneIcon = icon(CircleCheckBig, 'TaskDoneIcon')
export const LogOutIcon = icon(LogOut, 'LogOutIcon')
export const MenuIcon = icon(Menu, 'MenuIcon')
export const UserIcon = icon(User, 'UserIcon')
export const UsersIcon = icon(Users, 'UsersIcon')
export const ChevronRightIcon = icon(ChevronRight, 'ChevronRightIcon')
export const CloseIcon = icon(X, 'CloseIcon')
export const CopyIcon = icon(Copy, 'CopyIcon')
export const SearchIcon = icon(Search, 'SearchIcon')
export const SettingsIcon = icon(Settings, 'SettingsIcon')
export const InsightsIcon = icon(ChartColumn, 'InsightsIcon')
export const InboxIcon = icon(Inbox, 'InboxIcon')
export const InfoIcon = icon(Info, 'InfoIcon')
export const MinusIcon = icon(Minus, 'MinusIcon')
/** The "…" that opens a row's `Menu`, as the icon of an `IconButton` (docs/design-gaps.md §9, §12). */
export const RowMenuIcon = icon(MoreHorizontal, 'RowMenuIcon')

// The shell's navigation icons (sidebar, settings nav, account menu).
// oxlint-disable-next-line import/no-duplicates
import {
  Activity,
  Bell,
  Blocks,
  Building2,
  ChevronLeft,
  Hammer,
  Image as ImageGlyph,
  Layers,
  ListChecks,
  Database,
  Keyboard,
  KeyRound,
  Lock,
  ListFilter,
  Pin,
  Plus,
  ScanLine,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserPlus,
  Webhook,
  AlarmClock,
  ChartNoAxesColumn,
  CheckCheck,
  Frame,
  GitPullRequest,
  HardDrive,
  History,
  Images as ImagesGlyph,
  MessageSquare,
  Plug,
  Send,
  Settings2,
  SquareDashed,
} from 'lucide-react'

export const ActivityIcon = icon(Activity, 'ActivityIcon')
export const BellIcon = icon(Bell, 'BellIcon')
export const BlocksIcon = icon(Blocks, 'BlocksIcon')
export const BuildingIcon = icon(Building2, 'BuildingIcon')
export const ChevronLeftIcon = icon(ChevronLeft, 'ChevronLeftIcon')
export const DatabaseIcon = icon(Database, 'DatabaseIcon')
export const HammerIcon = icon(Hammer, 'HammerIcon')
export const ImageIcon = icon(ImageGlyph, 'ImageIcon')
export const LayersIcon = icon(Layers, 'LayersIcon')
export const ListChecksIcon = icon(ListChecks, 'ListChecksIcon')
export const KeyboardIcon = icon(Keyboard, 'KeyboardIcon')
export const KeyIcon = icon(KeyRound, 'KeyIcon')
export const LockIcon = icon(Lock, 'LockIcon')
export const ListFilterIcon = icon(ListFilter, 'ListFilterIcon')
export const PinIcon = icon(Pin, 'PinIcon')
export const PlusIcon = icon(Plus, 'PlusIcon')
export const ScanIcon = icon(ScanLine, 'ScanIcon')
export const ServerIcon = icon(Server, 'ServerIcon')
export const ShieldCheckIcon = icon(ShieldCheck, 'ShieldCheckIcon')
export const SlidersIcon = icon(SlidersHorizontal, 'SlidersIcon')
export const SunIcon = icon(Sun, 'SunIcon')
export const UserPlusIcon = icon(UserPlus, 'UserPlusIcon')
export const WebhookIcon = icon(Webhook, 'WebhookIcon')

// The empty states' icons (docs/design-gaps.md §5): Lucide, drawn at 32px by `EmptyState`.
export const AlarmClockIcon = icon(AlarmClock, 'AlarmClockIcon')
export const ChartNoAxesColumnIcon = icon(ChartNoAxesColumn, 'ChartNoAxesColumnIcon')
export const CheckCheckIcon = icon(CheckCheck, 'CheckCheckIcon')
export const FrameIcon = icon(Frame, 'FrameIcon')
export const PullRequestIcon = icon(GitPullRequest, 'PullRequestIcon')
export const HardDriveIcon = icon(HardDrive, 'HardDriveIcon')
export const HistoryIcon = icon(History, 'HistoryIcon')
export const ImagesIcon = icon(ImagesGlyph, 'ImagesIcon')
export const MessageSquareIcon = icon(MessageSquare, 'MessageSquareIcon')
export const PlugIcon = icon(Plug, 'PlugIcon')
export const SendIcon = icon(Send, 'SendIcon')
export const Settings2Icon = icon(Settings2, 'Settings2Icon')
export const SquareDashedIcon = icon(SquareDashed, 'SquareDashedIcon')
