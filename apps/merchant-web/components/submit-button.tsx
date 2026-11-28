"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function SubmitButton({
  children,
  pendingText,
  variant,
  size,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-disabled={pending}>
      {pending ? (pendingText ?? "Guardando…") : children}
    </Button>
  );
}
