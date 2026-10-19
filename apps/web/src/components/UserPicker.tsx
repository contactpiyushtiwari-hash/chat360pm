import type { GlobalRole } from '@chat360/core';
import { useSession } from '../lib/session';
import { Select } from './ui';

/** Picks an employee from the directory, optionally filtered to a role. */
export function UserSelect({
  value,
  onChange,
  role,
  allowEmpty = true,
  emptyLabel = 'Not assigned',
  exclude = [],
  ...a11y
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  role?: GlobalRole;
  allowEmpty?: boolean;
  emptyLabel?: string;
  exclude?: string[];
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}) {
  const { directory } = useSession();
  const options = directory.filter(
    (u) => (!role || u.roles.includes(role)) && !exclude.includes(u.id),
  );
  return (
    <Select {...a11y} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {!allowEmpty && !value && <option value="">Select…</option>}
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
    </Select>
  );
}

/** Multi-select as a checkbox list (more usable on touch devices than <select multiple>). */
export function UserMultiSelect({
  value,
  onChange,
  role,
  legend,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  role?: GlobalRole;
  legend: string;
}) {
  const { directory } = useSession();
  const options = directory.filter((u) => !role || u.roles.includes(role));
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      {options.length === 0 && (
        <p className="hint">No employees with this role yet. An administrator assigns roles.</p>
      )}
      <div className="check-grid">
        {options.map((u) => (
          <label key={u.id} className="check-pill">
            <input
              type="checkbox"
              checked={value.includes(u.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, u.id] : value.filter((x) => x !== u.id))
              }
            />
            {u.displayName}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
