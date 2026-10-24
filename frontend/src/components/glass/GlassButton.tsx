import type { ButtonHTMLAttributes } from "react";
import { GlassBackdrop } from "./GlassBackdrop";

export function GlassButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <span className="glassActionShell">
    <GlassBackdrop radius={999} variant="action" />
    <button {...props} className={`solidButton ${className}`}>{children}</button>
  </span>;
}
