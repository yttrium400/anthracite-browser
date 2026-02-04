import * as React from "react"
import { cn } from "../../lib/utils"

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> { }

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-10 w-full rounded-xl border border-border bg-surface-secondary px-4 py-2",
                    "text-sm text-text-primary font-medium",
                    "placeholder:text-text-tertiary",
                    "transition-all duration-200 ease-smooth",
                    "hover:border-border-strong",
                    "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    "file:border-0 file:bg-transparent file:text-sm file:font-medium",
                    className
                )}
                ref={ref}
                {...props}
            />
        )
    }
)
Input.displayName = "Input"

export { Input }
