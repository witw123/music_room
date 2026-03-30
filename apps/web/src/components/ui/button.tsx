import * as React from "react"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "glass"
  size?: "default" | "sm" | "lg" | "icon"
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => {
    let variantStyles = ""
    if (variant === "default") {
      variantStyles = "bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/20"
    } else if (variant === "ghost") {
      variantStyles = "hover:bg-white/10 text-foreground-muted hover:text-foreground"
    } else if (variant === "outline") {
      variantStyles = "border border-surface-border hover:bg-surface-hover text-foreground"
    } else if (variant === "glass") {
      variantStyles = "glass-button text-foreground text-foreground-muted hover:text-foreground"
    }

    let sizeStyles = ""
    if (size === "default") {
      sizeStyles = "h-10 px-4 py-2"
    } else if (size === "sm") {
      sizeStyles = "h-8 px-3 text-xs"
    } else if (size === "lg") {
      sizeStyles = "h-12 px-8 text-base rounded-2xl"
    } else if (size === "icon") {
      sizeStyles = "h-10 w-10 flex-shrink-0"
    }

    const baseStyles = "inline-flex items-center justify-center rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 active:scale-95"

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"
