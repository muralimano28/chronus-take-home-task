# Expert UI/UX Engineering Rules

You must follow these strict rules whenever you are generating or refactoring frontend code:

1. **Design System & Variables First**
   - **Tokens over values:** Never hardcode absolute values for colors, spacing, or font sizes. Always use CSS variables, Tailwind classes, or design tokens (e.g., `var(--color-primary)`, `gap-4`).
   - **Strict Theme Support:** Ensure all components natively support light and dark modes using a semantic naming convention (e.g., `bg-surface-primary`, `text-content-secondary`).
   - **No Static Color Classes:** Do not use static color utility class names (e.g., `bg-slate-50`, `dark:bg-slate-900`, `text-slate-500`, `border-slate-200`) inside components. Instead, always use theme-based semantic classes (e.g., `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`).
   - **Color Style Preference:** Always prefer solid colors to gradients for backgrounds, text, and components unless gradients are explicitly requested.

2. **Layout & Spacing Consistency**
   - **Grid & Flexbox:** Use Flexbox for 1D alignments and CSS Grid for 2D layouts. Never use absolute positioning for layout structure.
   - **The 8pt Grid Rule:** All padding, margins, and gaps must follow a strict 8px/8pt spacing scale (`4px`, `8px`, `16px`, `24px`, `32px`, etc.).
   - **Defensive Layouts:** Account for text wrapping, long content, and dynamic data. Use `truncate`, `min-width`, and `flex-wrap` to prevent UI breakage.

3. **Typography Hierarchy**
   - **Scale Limit:** Restrict the UI to a maximum of 4 font weights (Regular, Medium, Semi-Bold, Bold) and 5 functional type sizes (Caption, Body, Subheading, Heading, Display).
   - **Line Heights:** Always pair font sizes with proportional line heights to ensure optimal readability.

4. **UX & Component State Rules**
   - **Complete States:** Every interactive component must explicitly handle and style 5 distinct states: Default, Hover, Focus (visible outline for accessibility), Disabled (proper cursor and opacity), and Loading/Active.
   - **Touch Targets:** Ensure all interactive elements (buttons, links, icons) have a minimum interactive target size of 44x44 pixels for mobile responsiveness.
   - **Component Anatomy:** Keep structural logic separate from presentation. Group child items cleanly inside semantic HTML elements (`<nav>`, `<main>`, `<header>`, `<footer>`).

5. **Code Quality & Cleanliness**
   - **DRY Architecture:** Break complex interfaces down into small, reusable sub-components. If a layout pattern repeats twice, abstract it.
   - **Self-Documenting Code:** Write highly readable code with clear class names or component names. Avoid inline style overrides.
