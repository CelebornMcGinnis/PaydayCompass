import { PieChart, Calendar, Repeat, Target, Users, GitBranch, Bell, FileText, TrendingUp, Landmark, Settings as SettingsIcon, LineChart, ArrowLeftRight, Mail, ListPlus, FileSpreadsheet } from "lucide-react";

export const NAV_SECTIONS = [
  {
    label: "Money movement",
    links: [
      { to: "/payday", label: "Payday calculator", icon: Calendar, description: "Everything due before your next paycheck, adjustable, submitted as one batch." },
      { to: "/add-multiple", label: "Add multiple", icon: ListPlus, description: "Enter several transactions or recurring items at once, across any of your accounts." },
      { to: "/csv", label: "Import / export CSV", icon: FileSpreadsheet, description: "Download a template, fill it in, and bulk-import transactions or recurring items - or export a copy." },
      { to: "/transfer", label: "Transfer funds", icon: ArrowLeftRight, description: "Move money between two of your own accounts - posts real, linked transactions on both sides." },
      { to: "/recurring", label: "Recurring", icon: Repeat, description: "Create, edit, or delete recurring bills and income that post automatically on schedule." },
      { to: "/upcoming-recurring", label: "Upcoming expenses", icon: Calendar, description: "Every recurring expense's upcoming occurrences, chronologically - not just the next one." },
    ],
  },
  {
    label: "Budgeting & planning",
    links: [
      { to: "/budgets", label: "Budgets", icon: PieChart, description: "Set monthly limits per category — get alerted at 80%, when you go over, and on every purchase while you're still over." },
      { to: "/planned-expenses", label: "Planned expenses", icon: Target, description: "Save toward known future costs — a birthday, an annual premium — with a suggested monthly contribution." },
      { to: "/scenarios", label: "Scenarios", icon: GitBranch, description: "Test what-if changes — a raise, a new bill — and compare up to 6 scenarios against your real numbers." },
    ],
  },
  {
    label: "Insights",
    links: [
      { to: "/trends", label: "Category trends", icon: TrendingUp, description: "Spending by category over time, from 3 months back to 2 years." },
      { to: "/projected-vs-actual", label: "Projected vs Actual", icon: LineChart, description: "See a budgeted category's trajectory projected forward next to what your recent real spending pace projects to." },
    ],
  },
  {
    label: "Accounts & sharing",
    links: [
      { to: "/external-bank-accounts", label: "External bank accounts", icon: Landmark, description: "Label your real-world bank accounts so recurring bills can be grouped by which one pays for them." },
      { to: "/sharing", label: "Sharing", icon: Users, description: "Share an account with someone else — you choose exactly what they can see or edit, down to individual data types." },
      { to: "/notifications", label: "Notifications", icon: Bell, description: "Fund-movement alerts between you and people you trust — both sides have to agree before either can send them." },
    ],
  },
  {
    label: "Account",
    links: [
      { to: "/settings", label: "Settings", icon: SettingsIcon, description: "Change your password or email, turn alerts on or off, set up two-factor authentication, or delete your account." },
      { to: "/legal", label: "Terms & Privacy", icon: FileText, description: "The app's legal policies." },
      { to: "/contact", label: "Contact", icon: Mail, description: "Reach out with questions, comments, or concerns." },
    ],
  },
];

// Flat form, derived from the sections above - for anywhere that just
// needs every link without the grouping (the walkthrough step list).
export const NAV_LINKS = NAV_SECTIONS.flatMap((section) => section.links);
