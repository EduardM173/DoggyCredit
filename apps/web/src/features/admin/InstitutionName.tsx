import type { ReactNode } from "react";

export function InstitutionName({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="institution-name">
      <span className="institution-initials" aria-hidden="true">
        {name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")}
      </span>
      <div>{children ?? <strong>{name}</strong>}</div>
    </div>
  );
}
