import { useEffect, useRef } from 'react';

type Props = {
  checked: boolean;
  /** Shown as a dash: some, but not all, of what this box stands for is checked. */
  mixed?: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ checked, mixed = false, label, disabled = false, onChange }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="check"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
